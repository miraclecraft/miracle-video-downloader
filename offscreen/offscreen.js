// Downloads stream segments / separate audio+video files, merges them with
// ffmpeg.wasm when needed, and hands back a blob URL. Runs in an offscreen
// document because service workers cannot create blob URLs or parse XML.
import { parsePlaylist, isDrmProtected, audioForVariant } from '../lib/hls.js';
import { parseMpd, summarizeMpd } from '../lib/dash.js';
import { sniffContainer } from '../lib/mp4.js';
import { speedMeter, etaSeconds } from '../lib/common.js';

const CONCURRENCY = 6;
const RETRIES = 3;

const controls = new Map(); // jobId -> JobControl
const blobUrls = new Map(); // jobId -> blob URL

// Cancel and pause for one job. Pausing aborts the requests in flight; they
// wait at gate() and continue from the bytes they already have on resume.
class JobControl {
  #cancel = new AbortController();
  #pause = null;
  #waiters = [];
  paused = false;

  get cancelled() {
    return this.#cancel.signal.aborted;
  }

  // For requests that shouldn't be interrupted by a pause (playlists, manifests).
  get cancelSignal() {
    return this.#cancel.signal;
  }

  cancel() {
    this.#cancel.abort();
    this.resume();
  }

  pause() {
    this.paused = true;
    this.#pause?.abort();
    this.#pause = null;
  }

  resume() {
    this.paused = false;
    for (const wake of this.#waiters.splice(0)) wake();
  }

  async gate() {
    while (this.paused && !this.cancelled) await new Promise((r) => this.#waiters.push(r));
    if (this.cancelled) throw new DOMException('Aborted', 'AbortError');
  }

  // Signal for one request: aborted by cancel, or by a pause.
  signal() {
    this.#pause ??= new AbortController();
    if (this.paused) this.#pause.abort();
    return AbortSignal.any([this.#cancel.signal, this.#pause.signal]);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  // Always answer: an unanswered message rejects the sender's promise.
  switch (msg.type) {
    case 'start-job':
      runJob(msg.job);
      sendResponse({ ok: true });
      return;
    case 'cancel':
      controls.get(msg.jobId)?.cancel();
      sendResponse({ ok: true });
      return;
    case 'pause':
    case 'resume': {
      const control = controls.get(msg.jobId);
      if (control) msg.type === 'pause' ? control.pause() : control.resume();
      sendResponse({ ok: !!control });
      return;
    }
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

// Fetches a whole file (or byte range). After a pause or a dropped connection
// it asks for the remaining bytes only, so nothing is downloaded twice.
// onBytes(delta, received, total) reports progress; total is 0 when unknown.
async function fetchBytes(url, byterange, control, onBytes = () => {}) {
  const start = byterange?.offset ?? 0;
  const end = byterange ? byterange.offset + byterange.length - 1 : '';
  const chunks = [];
  let received = 0;
  let total = byterange?.length || 0;
  let failures = 0;
  for (;;) {
    await control.gate();
    const headers = byterange || received ? { Range: `bytes=${start + received}-${end}` } : undefined;
    try {
      const res = await fetch(url, { headers, signal: control.signal(), credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).pathname}`);
      if (received && res.status !== 206) {
        // The server ignored the Range header and sent everything again.
        onBytes(-received, 0, total);
        chunks.length = 0;
        received = 0;
      }
      if (!total) {
        const range = res.headers.get('content-range')?.match(/\/(\d+)\s*$/);
        total = range ? Number(range[1]) : received + (Number(res.headers.get('content-length')) || 0);
      }
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onBytes(value.byteLength, received, total);
      }
      return concat(chunks);
    } catch (e) {
      if (control.cancelled) throw e;
      if (control.paused) continue; // wait at the gate, then continue from `received`
      if (++failures >= RETRIES) throw e;
      await sleep(500 * failures);
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

async function decrypt(segment, data, keys, control) {
  if (!segment.key) return data;
  if (!keys.has(segment.key.uri)) {
    keys.set(
      segment.key.uri,
      fetchBytes(segment.key.uri, null, control).then((raw) =>
        crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt'])
      )
    );
  }
  const key = await keys.get(segment.key.uri);
  // Per the HLS spec, a missing IV defaults to the segment's media sequence number.
  const iv = segment.key.iv ? hexToBytes(segment.key.iv) : sequenceIv(segment.seq);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, data));
}

// Combined numbers for the popup. A single file's size is known from its
// headers; a segmented track's size is estimated from the segments done so far.
function trackStats(tracks, state) {
  let bytes = 0;
  let total = 0;
  let estimated = false;
  let unknown = false;
  const fractions = tracks.map((track, t) => {
    const s = state[t];
    bytes += s.bytes;
    if (track.single) {
      if (s.total) total += s.total;
      else unknown = true;
      return s.total ? s.bytes / s.total : 0;
    }
    if (s.done) {
      total += (s.segmentBytes / s.done) * track.segments.length;
      estimated ||= s.done < track.segments.length;
    } else unknown = true;
    return s.done / track.segments.length;
  });
  // Until every track's size can be worked out, go by how much of each is done.
  if (unknown) return { bytes, total: 0, totalEstimated: true, progress: fractions.reduce((a, b) => a + b, 0) / tracks.length };
  total = Math.max(total, bytes);
  return { bytes, total, totalEstimated: estimated, progress: total ? bytes / total : 0 };
}

// Downloads every track, reporting combined progress; returns one byte array per track.
async function downloadTracks(tracks, control, report) {
  const state = tracks.map(() => ({ bytes: 0, total: 0, done: 0, segmentBytes: 0 }));
  const meter = speedMeter();
  let lastReport = 0;
  let wasPaused = false;
  const update = (force) => {
    const now = Date.now();
    if (!force && now - lastReport < 500) return;
    lastReport = now;
    const stats = trackStats(tracks, state);
    const speed = meter.update(stats.bytes, now);
    report({ ...stats, speed, eta: etaSeconds(stats.bytes, stats.total, speed) });
  };
  // Pause/resume reports come from a timer: while paused nothing else is happening.
  const ticker = setInterval(() => {
    if (control.paused === wasPaused) return;
    wasPaused = control.paused;
    meter.reset();
    report(wasPaused ? { status: 'paused', speed: 0, eta: 0 } : { status: 'downloading' });
  }, 250);

  try {
    return await Promise.all(
      tracks.map(async (track, t) => {
        const s = state[t];
        const keys = new Map();
        const head = track.init ? [await fetchBytes(track.init.url, track.init.byterange, control)] : [];
        const onBytes = (delta, _received, total) => {
          s.bytes += delta;
          if (track.single) s.total = total;
          update();
        };

        if (track.single) {
          const seg = track.segments[0];
          const data = await fetchBytes(seg.url, seg.byterange, control, onBytes);
          update(true);
          return concat([...head, data]);
        }

        const parts = new Array(track.segments.length);
        let next = 0;
        const worker = async () => {
          while (next < track.segments.length) {
            const i = next++;
            const seg = track.segments[i];
            const data = await fetchBytes(seg.url, seg.byterange, control, onBytes);
            parts[i] = await decrypt(seg, data, keys, control);
            s.done++;
            s.segmentBytes += data.byteLength;
            update();
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, track.segments.length) }, worker));
        update(true);
        return concat([...head, ...parts]);
      })
    );
  } finally {
    clearInterval(ticker);
  }
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
  const control = new JobControl();
  controls.set(id, control);
  const report = (patch) => toBackground('job-update', { jobId: id, patch }).catch(() => {});

  try {
    await setReferer(sources.map((s) => s.url), referer);
    const tracks = await resolveTracks(sources, control.cancelSignal);
    const urls = tracks.flatMap((t) => [
      ...t.segments.map((s) => s.url),
      ...t.segments.filter((s) => s.key).map((s) => s.key.uri),
      ...(t.init ? [t.init.url] : []),
    ]);
    await setReferer(urls, referer);

    report({ status: 'downloading', progress: 0, live: tracks.some((t) => t.live) });
    const outputs = await downloadTracks(tracks, control, report);
    if (control.cancelled) throw new DOMException('Aborted', 'AbortError');

    const { blob, ext } = await assemble(outputs, report);
    const blobUrl = URL.createObjectURL(blob);
    blobUrls.set(id, blobUrl);
    await toBackground('job-ready', { jobId: id, blobUrl, ext });
  } catch (e) {
    if (control.cancelled) report({ status: 'cancelled' });
    else report({ status: 'error', error: e.message });
  } finally {
    controls.delete(id);
  }
}
