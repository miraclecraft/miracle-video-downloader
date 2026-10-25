// Downloads stream segments / separate audio+video files, merges them with
// ffmpeg.wasm when needed, and hands back a blob URL. Runs in an offscreen
// document because service workers cannot create blob URLs or parse XML.
import { parsePlaylist, isDrmProtected, audioForVariant } from '../lib/hls.js';
import { parseMpd, summarizeMpd } from '../lib/dash.js';
import { sniffContainer } from '../lib/mp4.js';

const CONCURRENCY = 6;
const RETRIES = 3;

const controllers = new Map(); // jobId -> AbortController
const blobUrls = new Map(); // jobId -> blob URL

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  // Always answer: an unanswered message rejects the sender's promise.
  switch (msg.type) {
    case 'start-job':
      runJob(msg.job);
      sendResponse({ ok: true });
      return;
    case 'cancel':
      controllers.get(msg.jobId)?.abort();
      sendResponse({ ok: true });
      return;
    case 'revoke': {
      const url = blobUrls.get(msg.jobId);
      if (url) URL.revokeObjectURL(url);
      blobUrls.delete(msg.jobId);
      sendResponse({ ok: true });
      return;
    }
    case 'inspect-dash':
      loadMpd(msg.url).then(
        (mpd) => sendResponse({ ok: true, summary: summarizeMpd(mpd) }),
        (e) => sendResponse({ ok: false, error: e.message })
      );
      return true;
  }
});

function toBackground(type, payload) {
  return chrome.runtime.sendMessage({ target: 'background', type, ...payload });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setReferer(urls, referer) {
  if (!referer || !urls.length) return;
  const hosts = [...new Set(urls.map((u) => new URL(u).hostname))];
  await toBackground('set-referer', { hosts, referer });
}

// ---------------------------------------------------------------------------
// Fetching

async function fetchBytes(url, byterange, signal, onBytes) {
  const headers = byterange
    ? { Range: `bytes=${byterange.offset}-${byterange.offset + byterange.length - 1}` }
    : undefined;
  for (let attempt = 1; ; attempt++) {
    let received = 0;
    try {
      const res = await fetch(url, { headers, signal, credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).pathname}`);
      if (!onBytes) return new Uint8Array(await res.arrayBuffer());
      // Stream large files so progress can be reported while they download.
      const total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body.getReader();
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onBytes(value.byteLength, received, total);
      }
      return concat(chunks);
    } catch (e) {
      if (received && onBytes) onBytes(-received, 0, 0);
      if (signal.aborted || attempt >= RETRIES) throw e;
      await sleep(500 * attempt);
    }
  }
}

function concat(chunks) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
}

async function loadPlaylist(url, signal) {
  const res = await fetch(url, { signal, credentials: 'include' });
  if (!res.ok) throw new Error(`Playlist request failed (HTTP ${res.status})`);
  return parsePlaylist(await res.text(), res.url);
}

async function loadMpd(url, signal) {
  const res = await fetch(url, { signal, credentials: 'include' });
  if (!res.ok) throw new Error(`Manifest request failed (HTTP ${res.status})`);
  return parseMpd(await res.text(), res.url);
}

// ---------------------------------------------------------------------------
// Resolving sources into { init, segments } tracks

async function resolveTracks(sources, signal) {
  const tracks = [];
  const mpdCache = new Map();
  for (const src of sources) {
    if (src.type === 'file') {
      tracks.push({ init: null, segments: [{ url: src.url }], single: true });
    } else if (src.type === 'hls') {
      let playlist = await loadPlaylist(src.url, signal);
      if (playlist.type === 'master') {
        // Detection didn't get to inspect it: take the best variant and its audio.
        const variant = playlist.variants[0];
        if (!variant) throw new Error('Master playlist has no variants');
        const audio = audioForVariant(playlist, variant);
        if (audio) sources.push({ type: 'hls', url: audio.url });
        playlist = await loadPlaylist(variant.url, signal);
      }
      if (!playlist.segments.length) throw new Error('Playlist has no segments');
      if (isDrmProtected(playlist)) throw new Error('This stream is DRM protected');
      tracks.push({ init: playlist.segments[0].map, segments: playlist.segments, live: playlist.live });
    } else if (src.type === 'dash') {
      if (!mpdCache.has(src.url)) mpdCache.set(src.url, await loadMpd(src.url, signal));
      const mpd = mpdCache.get(src.url);
      if (mpd.live) throw new Error('Live DASH streams are not supported');
      const reps = src.role === 'audio' ? mpd.audio : mpd.video;
      const rep = reps.find((r) => r.id === src.repId) || reps[0];
      if (!rep) continue;
      if (rep.drm) throw new Error('This stream is DRM protected');
      tracks.push({ init: rep.init, segments: rep.segments, single: rep.segments.length === 1 });
    }
  }
  if (!tracks.length) throw new Error('Nothing to download');
  return tracks;
}

// ---------------------------------------------------------------------------
// Downloading

function sequenceIv(seq) {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setUint32(12, seq);
  return iv;
}

function hexToBytes(hex) {
  hex = hex.replace(/^0x/i, '').padStart(32, '0');
  return new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16)));
}

async function decrypt(segment, data, keys, signal) {
  if (!segment.key) return data;
  if (!keys.has(segment.key.uri)) {
    keys.set(
      segment.key.uri,
      fetchBytes(segment.key.uri, null, signal).then((raw) =>
        crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt'])
      )
    );
  }
  const key = await keys.get(segment.key.uri);
  // Per the HLS spec, a missing IV defaults to the segment's media sequence number.
  const iv = segment.key.iv ? hexToBytes(segment.key.iv) : sequenceIv(segment.seq);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, data));
}

// Downloads every track, reporting combined progress; returns one byte array per track.
async function downloadTracks(tracks, signal, report) {
  const progress = tracks.map(() => 0);
  let bytes = 0;
  let lastReport = 0;
  const update = (force) => {
    const now = Date.now();
    if (!force && now - lastReport < 500) return;
    lastReport = now;
    report({ progress: progress.reduce((a, b) => a + b, 0) / tracks.length, bytes });
  };

  return Promise.all(
    tracks.map(async (track, t) => {
      const keys = new Map();
      const head = track.init ? [await fetchBytes(track.init.url, track.init.byterange, signal)] : [];

      if (track.single) {
        const seg = track.segments[0];
        const data = await fetchBytes(seg.url, seg.byterange, signal, (delta, received, total) => {
          bytes += delta;
          if (total) progress[t] = received / total;
          update();
        });
        progress[t] = 1;
        update(true);
        return concat([...head, data]);
      }

      const parts = new Array(track.segments.length);
      let next = 0;
      let done = 0;
      const worker = async () => {
        while (next < track.segments.length) {
          const i = next++;
          const seg = track.segments[i];
          parts[i] = await decrypt(seg, await fetchBytes(seg.url, seg.byterange, signal), keys, signal);
          bytes += parts[i].byteLength;
          progress[t] = ++done / track.segments.length;
          update();
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, track.segments.length) }, worker));
      update(true);
      return concat([...head, ...parts]);
    })
  );
}

// ---------------------------------------------------------------------------
// Merging with ffmpeg.wasm (loaded lazily: it is a 30 MB module)

let ffmpegPromise = null;
let ffmpegQueue = Promise.resolve();

function getFfmpeg() {
  ffmpegPromise ??= (async () => {
    const { FFmpeg } = await import('../vendor/ffmpeg/index.js');
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: chrome.runtime.getURL('vendor/ffmpeg-core/ffmpeg-core.js'),
      wasmURL: chrome.runtime.getURL('vendor/ffmpeg-core/ffmpeg-core.wasm'),
    });
    return ffmpeg;
  })();
  ffmpegPromise.catch(() => (ffmpegPromise = null));
  return ffmpegPromise;
}

const EXT = { mp4: 'mp4', webm: 'webm', ts: 'ts', bin: 'bin' };

// Runs one ffmpeg job at a time; the wasm instance is single threaded.
function runFfmpeg(inputs, outExt, args) {
  const run = ffmpegQueue.then(async () => {
    const ffmpeg = await getFfmpeg();
    const names = inputs.map((data, i) => `in${i}.${EXT[sniffContainer(data)]}`);
    const out = `out.${outExt}`;
    try {
      for (let i = 0; i < inputs.length; i++) await ffmpeg.writeFile(names[i], inputs[i]);
      const code = await ffmpeg.exec([...names.flatMap((n) => ['-i', n]), ...args, '-y', out]);
      if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
      return await ffmpeg.readFile(out);
    } finally {
      for (const n of [...names, out]) await ffmpeg.deleteFile(n).catch(() => {});
    }
  });
  ffmpegQueue = run.catch(() => {});
  return run;
}

async function assemble(outputs, report) {
  const kinds = outputs.map(sniffContainer);

  if (outputs.length === 1) {
    if (kinds[0] !== 'ts') return { blob: new Blob([outputs[0]]), ext: `.${EXT[kinds[0]] === 'bin' ? 'mp4' : EXT[kinds[0]]}` };
    // MPEG-TS plays poorly in most apps; remux to MP4 without re-encoding.
    report({ status: 'merging' });
    try {
      // ffmpeg.wasm transfers (detaches) its inputs; keep the original for the fallback.
      const data = await runFfmpeg([outputs[0].slice()], 'mp4', ['-c', 'copy']);
      return { blob: new Blob([data], { type: 'video/mp4' }), ext: '.mp4' };
    } catch (e) {
      console.warn('TS remux failed, saving as .ts', e);
      return { blob: new Blob([outputs[0]], { type: 'video/mp2t' }), ext: '.ts' };
    }
  }

  report({ status: 'merging' });
  const outExt = kinds.every((k) => k === 'webm') ? 'webm' : kinds.some((k) => k === 'webm') ? 'mkv' : 'mp4';
  const data = await runFfmpeg(outputs, outExt, ['-map', '0:v:0?', '-map', '1:a:0?', '-c', 'copy']);
  return { blob: new Blob([data], { type: outExt === 'mp4' ? 'video/mp4' : 'video/webm' }), ext: `.${outExt}` };
}

// ---------------------------------------------------------------------------

async function runJob({ id, tracks: sources, referer }) {
  const controller = new AbortController();
  const { signal } = controller;
  controllers.set(id, controller);
  const report = (patch) => toBackground('job-update', { jobId: id, patch }).catch(() => {});

  try {
    await setReferer(sources.map((s) => s.url), referer);
    const tracks = await resolveTracks(sources, signal);
    const urls = tracks.flatMap((t) => [
      ...t.segments.map((s) => s.url),
      ...t.segments.filter((s) => s.key).map((s) => s.key.uri),
      ...(t.init ? [t.init.url] : []),
    ]);
    await setReferer(urls, referer);

    report({ status: 'downloading', progress: 0, live: tracks.some((t) => t.live) });
    const outputs = await downloadTracks(tracks, signal, report);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const { blob, ext } = await assemble(outputs, report);
    const blobUrl = URL.createObjectURL(blob);
    blobUrls.set(id, blobUrl);
    await toBackground('job-ready', { jobId: id, blobUrl, ext });
  } catch (e) {
    if (signal.aborted) report({ status: 'cancelled' });
    else report({ status: 'error', error: e.message });
  } finally {
    controllers.delete(id);
  }
}
