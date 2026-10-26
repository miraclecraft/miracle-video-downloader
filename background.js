import { buildEntries, sanitizeFilename, speedMeter, etaSeconds } from './lib/common.js';
import { parsePlaylist, isDrmProtected, audioForVariant } from './lib/hls.js';
import { probeMp4 } from './lib/mp4.js';
import { isSocialHost, normalizeSocialUrl, socialHints } from './lib/social.js';
import { companionTarget, toNetscapeCookies, COMPANION_MISSING } from './lib/companion.js';

const HLS_MIME = new Set(['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl', 'audio/x-mpegurl']);
const DASH_MIME = new Set(['application/dash+xml']);
const FILE_EXT = /\.(mp4|m4v|webm|mov|mkv|flv|ogv|3gp)$/i;
const SEGMENT_EXT = /\.(ts|m4s|m4a|aac|cmfv|cmfa)$/i;
const GENERIC_MIME = new Set(['', 'application/octet-stream', 'binary/octet-stream']);
const MIME_EXT = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'video/x-matroska': '.mkv',
  'video/x-flv': '.flv',
  'video/ogg': '.ogv',
  'video/3gpp': '.3gp',
  'audio/mp4': '.m4a',
};
// YouTube serves scrambled, split audio/video chunks; downloading it is not supported.
const IGNORED_HOSTS = [/(^|\.)googlevideo\.com$/i];
const MIN_FILE_SIZE = 256 * 1024;
const MAX_ITEMS_PER_TAB = 150;
const PROBE_BYTES = 128 * 1024;
// Unlabelled social video/audio files detected this close together are assumed to belong together.
const PAIR_WINDOW_MS = 20_000;

// tabId -> { items: [...] }, mirrored to storage.session so it survives worker restarts.
const state = new Map();
// Tabs showing a video page the companion app looks up automatically (YouTube, X, TikTok…).
const companionTabs = new Set();
let jobs = {};

const ready = chrome.storage.session.get(null).then((all) => {
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('tab:')) state.set(Number(key.slice(4)), value);
  }
  jobs = all.jobs || {};
  watchDownloads();
});

chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });

// ---------------------------------------------------------------------------
// Detection

function classify(url, mime) {
  let path;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  mime = (mime || '').split(';')[0].trim().toLowerCase();
  if (HLS_MIME.has(mime) || path.endsWith('.m3u8')) return 'hls';
  if (DASH_MIME.has(mime) || path.endsWith('.mpd')) return 'dash';
  if (isSocialHost(url)) return mime.startsWith('video/') || mime.startsWith('audio/') ? 'file' : null;
  if (SEGMENT_EXT.test(path) || mime === 'video/mp2t') return null;
  if (mime.startsWith('video/')) return 'file';
  if (FILE_EXT.test(path) && GENERIC_MIME.has(mime)) return 'file';
  return null;
}

function header(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name)?.value || '';
}

function totalSize(headers) {
  const total = header(headers, 'content-range').match(/\/(\d+)\s*$/);
  if (total) return Number(total[1]);
  return Number(header(headers, 'content-length')) || 0;
}

function isIgnored(url) {
  try {
    const host = new URL(url).hostname;
    return IGNORED_HOSTS.some((re) => re.test(host));
  } catch {
    return true;
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.frameId === 0) clearTab(details.tabId);
  },
  { urls: ['<all_urls>'], types: ['main_frame'] }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    // tabId -1 covers our own fetches and downloads, which must not be re-detected.
    if (details.tabId < 0 || !/^https?:/i.test(details.url) || isIgnored(details.url)) return;
    if (details.statusCode !== 200 && details.statusCode !== 206) return;
    const mime = header(details.responseHeaders, 'content-type').split(';')[0].trim();
    const kind = classify(details.url, mime);
    if (!kind) return;

    if (isSocialHost(details.url)) {
      // Each request is only a slice; the probe fetches the real size later.
      onDetected(details.tabId, { url: normalizeSocialUrl(details.url), kind, mime, social: true, ...socialHints(details.url) });
      return;
    }
    const size = totalSize(details.responseHeaders);
    if (kind === 'file' && size && size < MIN_FILE_SIZE) return;
    onDetected(details.tabId, { url: details.url, kind, mime, size });
  },
  { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other', 'object'] },
  ['responseHeaders']
);

chrome.tabs.onRemoved.addListener((tabId) => {
  companionTabs.delete(tabId);
  clearTab(tabId);
});

// Sites like YouTube navigate without page loads, so follow URL changes instead.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  if (companionTarget(changeInfo.url)?.auto) companionTabs.add(tabId);
  else companionTabs.delete(tabId);
  updateBadge(tabId);
});

function onDomVideos(tabId, videos) {
  for (const v of videos) {
    if (isIgnored(v.url)) continue;
    // A <video src> is a video even when its URL has no telling extension.
    const kind = classify(v.url, '') || 'file';
    onDetected(tabId, { url: v.url, kind, width: v.width, height: v.height, duration: v.duration });
  }
}

async function onDetected(tabId, data) {
  const item = await addItem(tabId, data);
  if (!item) return;
  if (item.kind === 'hls') inspectHls(tabId, item);
  else if (item.kind === 'dash') inspectDash(tabId, item);
  else if (item.social || /mp4|m4v|mov|m4a/.test(item.mime || '') || /\.(mp4|m4v|mov)(?:$|[?#])/i.test(item.url)) {
    probeFile(tabId, item);
  }
}

function definedOnly(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 0));
}

function findItem(tabId, id) {
  return state.get(tabId)?.items.find((i) => i.id === id);
}

async function addItem(tabId, data) {
  await ready;
  let entry = state.get(tabId);
  if (!entry) {
    entry = { items: [] };
    state.set(tabId, entry);
  }
  const existing = entry.items.find((i) => i.url === data.url);
  if (existing) {
    // Players issue many range requests for the same file; only persist real changes.
    const before = JSON.stringify(existing);
    Object.assign(existing, definedOnly(data));
    if (JSON.stringify(existing) !== before) persistTab(tabId);
    return null;
  }
  if (entry.items.length >= MAX_ITEMS_PER_TAB) entry.items.shift();
  const item = { id: crypto.randomUUID(), detectedAt: Date.now(), ...definedOnly(data) };
  entry.items.push(item);
  persistTab(tabId);
  return item;
}

function updateItem(tabId, id, patch) {
  const item = findItem(tabId, id);
  if (!item) return null;
  Object.assign(item, definedOnly(patch));
  persistTab(tabId);
  return item;
}

// Reads the first bytes of an MP4 to learn its size, resolution and which
// tracks (video/audio) it contains.
async function probeFile(tabId, item) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await setReferer([new URL(item.url).hostname], tab.url);
    const res = await fetch(item.url, { headers: { Range: `bytes=0-${PROBE_BYTES - 1}` }, credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const size = totalSize([...res.headers].map(([name, value]) => ({ name, value })));
    const bytes = await readUpTo(res, PROBE_BYTES);
    const info = probeMp4(bytes);
    const track = info ? (info.hasVideo && info.hasAudio ? 'both' : info.hasVideo ? 'video' : info.hasAudio ? 'audio' : undefined) : undefined;
    const updated = updateItem(tabId, item.id, {
      size,
      track,
      width: info?.width,
      height: info?.height,
      duration: info?.duration,
    });
    if (updated?.social && !updated.group && (track === 'video' || track === 'audio')) pairByTime(tabId, updated);
  } catch (e) {
    console.warn('Probe failed', item.url, e);
  }
}

async function readUpTo(res, limit) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  reader.cancel().catch(() => {});
  const out = new Uint8Array(Math.min(total, limit));
  let pos = 0;
  for (const c of chunks) {
    const part = c.subarray(0, out.length - pos);
    out.set(part, pos);
    pos += part.length;
    if (pos >= out.length) break;
  }
  return out;
}

// Fallback when the CDN URL carries no asset id: pair a video-only file with
// the closest-in-time audio-only file that has no partner yet.
function pairByTime(tabId, item) {
  const items = state.get(tabId)?.items || [];
  const wanted = item.track === 'video' ? 'audio' : 'video';
  let best = null;
  for (const other of items) {
    if (other === item || !other.social || other.group || other.track !== wanted) continue;
    const gap = Math.abs(other.detectedAt - item.detectedAt);
    if (gap <= PAIR_WINDOW_MS && (!best || gap < Math.abs(best.detectedAt - item.detectedAt))) best = other;
  }
  if (!best) return;
  const group = `pair:${item.id}`;
  item.group = group;
  best.group = group;
  persistTab(tabId);
}

async function inspectHls(tabId, item) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await setReferer([new URL(item.url).hostname], tab.url);
    const res = await fetch(item.url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pl = parsePlaylist(await res.text(), res.url);
    const hls =
      pl.type === 'master'
        ? {
            type: 'master',
            variants: pl.variants.map((v) => ({
              url: v.url,
              bandwidth: v.bandwidth,
              resolution: v.resolution,
              audioUrl: audioForVariant(pl, v)?.url || null,
            })),
            audio: pl.audio.map((a) => a.url),
          }
        : { type: 'media', duration: pl.duration, segments: pl.segments.length, live: pl.live, drm: isDrmProtected(pl) };
    updateItem(tabId, item.id, { hls });
  } catch (e) {
    console.warn('HLS inspection failed', item.url, e);
  }
}

async function inspectDash(tabId, item) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await setReferer([new URL(item.url).hostname], tab.url);
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'inspect-dash', url: item.url });
    if (!res?.ok) throw new Error(res?.error || 'no response');
    updateItem(tabId, item.id, { dash: res.summary, duration: res.summary.duration });
  } catch (e) {
    console.warn('DASH inspection failed', item.url, e);
  }
}

function clearTab(tabId) {
  if (!state.has(tabId)) return;
  state.delete(tabId);
  persistTab(tabId);
}

function persistTab(tabId) {
  const key = `tab:${tabId}`;
  const entry = state.get(tabId);
  (entry ? chrome.storage.session.set({ [key]: entry }) : chrome.storage.session.remove(key)).catch(() => {});
  updateBadge(tabId);
}

function updateBadge(tabId) {
  const count = buildEntries(state.get(tabId)?.items || []).length + (companionTabs.has(tabId) ? 1 : 0);
  chrome.action.setBadgeText({ tabId, text: count ? String(count) : '' }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Referer spoofing for extension-initiated requests (many CDNs reject requests
// without the page's Referer). Rules only match requests outside any tab.

function ruleId(host) {
  let h = 0;
  for (const c of host) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (Math.abs(h) % 2_000_000_000) + 1;
}

async function setReferer(hosts, referer) {
  if (!referer || !/^https?:/i.test(referer)) return;
  const rules = [...new Set(hosts)].map((host) => ({
    id: ruleId(host),
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'Referer', operation: 'set', value: referer }],
    },
    condition: { requestDomains: [host], tabIds: [chrome.tabs.TAB_ID_NONE] },
  }));
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id), addRules: rules });
  } catch (e) {
    console.warn('Could not set Referer rule', e);
  }
}

// ---------------------------------------------------------------------------
// Downloads

function fileExtension(item) {
  const ext = new URL(item.url).pathname.match(FILE_EXT)?.[0];
  return ext ? ext.toLowerCase() : MIME_EXT[item.mime] || (item.track === 'audio' ? '.m4a' : '.mp4');
}

// Tracks the offscreen document must fetch (and merge, if more than one).
// Returns null when a single complete file can go straight to the download manager.
function buildTracks(item, choice, tabItems) {
  if (item.kind === 'file') {
    const audio = choice.audioId && tabItems.find((i) => i.id === choice.audioId);
    if (!audio || item.track !== 'video') return null;
    return [
      { type: 'file', url: item.url },
      { type: 'file', url: audio.url },
    ];
  }
  if (item.kind === 'hls') {
    if (item.hls?.drm) throw new Error('This stream is DRM protected');
    const variant = item.hls?.variants?.find((v) => v.url === choice.variantUrl) || item.hls?.variants?.[0];
    const tracks = [{ type: 'hls', url: variant?.url || item.url }];
    if (variant?.audioUrl) tracks.push({ type: 'hls', url: variant.audioUrl });
    return tracks;
  }
  if (item.kind === 'dash') {
    if (item.dash?.drm) throw new Error('This stream is DRM protected');
    if (item.dash?.live) throw new Error('Live DASH streams are not supported');
    const tracks = [{ type: 'dash', url: item.url, role: 'video', repId: choice.videoRep || null }];
    if (!item.dash || item.dash.audio.length) tracks.push({ type: 'dash', url: item.url, role: 'audio', repId: choice.audioRep || null });
    return tracks;
  }
  throw new Error('Unsupported video type');
}

async function startDownload({ tabId, itemId, choice = {} }) {
  await ready;
  const tabItems = state.get(tabId)?.items || [];
  const item = tabItems.find((i) => i.id === itemId);
  if (!item) throw new Error('Video is no longer available, reload the page');
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const quality = choice.height || item.height;
  const base = sanitizeFilename(tab?.title) + (quality ? ` (${quality}p)` : '');

  const tracks = buildTracks(item, choice, tabItems);
  const id = crypto.randomUUID();
  if (!tracks) {
    // A single complete file: the browser's download manager fetches it, and
    // its progress is mirrored into a job so the popup can show and pause it.
    await setReferer([new URL(item.url).hostname], tab?.url);
    const downloadId = await chrome.downloads.download({ url: item.url, filename: base + fileExtension(item), conflictAction: 'uniquify' });
    jobs[id] = { id, source: 'browser', title: base, status: 'downloading', progress: 0, bytes: 0, total: item.size || 0, downloadId, createdAt: Date.now() };
    saveJobs();
    watchDownloads();
    return { ok: true, jobId: id };
  }

  jobs[id] = { id, title: base, status: 'starting', progress: 0, bytes: 0, createdAt: Date.now() };
  saveJobs();
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start-job', job: { id, tracks, referer: tab?.url } });
  return { ok: true, jobId: id };
}

let creatingOffscreen = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['BLOBS', 'DOM_PARSER'],
      justification: 'Download stream segments, merge audio/video and parse DASH manifests',
    })
    .finally(() => (creatingOffscreen = null));
  await creatingOffscreen;
}

function saveJobs() {
  chrome.storage.session.set({ jobs }).catch(() => {});
}

async function updateJob(id, patch) {
  await ready;
  if (!jobs[id]) return;
  Object.assign(jobs[id], patch);
  saveJobs();
}

function revokeBlob(jobId) {
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'revoke', jobId }).catch(() => {});
}

async function onJobReady({ jobId, blobUrl, ext }) {
  await ready;
  const job = jobs[jobId];
  if (!job || job.status === 'cancelled') return revokeBlob(jobId);
  try {
    const downloadId = await chrome.downloads.download({ url: blobUrl, filename: job.title + ext, conflictAction: 'uniquify' });
    updateJob(jobId, { status: 'saving', progress: 1, downloadId });
  } catch (e) {
    updateJob(jobId, { status: 'error', error: e.message });
    revokeBlob(jobId);
  }
}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state) return;
  await ready;
  const job = Object.values(jobs).find((j) => j.downloadId === delta.id);
  if (!job) return;
  const done = delta.state.current === 'complete';
  if (done) {
    updateJob(job.id, { status: 'done', progress: 1, speed: 0, eta: 0, ...(job.total && { bytes: job.total }) });
  } else if (delta.state.current === 'interrupted') {
    const reason = delta.error?.current;
    updateJob(job.id, reason === 'USER_CANCELED' ? { status: 'cancelled' } : { status: 'error', error: reason || 'Download interrupted' });
  } else return;
  if (job.source !== 'browser') revokeBlob(job.id);
});

const ACTIVE = new Set(['starting', 'downloading', 'merging', 'saving']);
const FINISHED = new Set(['done', 'error', 'cancelled']);

// The download manager has no progress events, so poll it while direct
// downloads are running.
let watchTimer = null;
const meters = new Map(); // jobId -> speedMeter

function watchDownloads() {
  if (watchTimer || !Object.values(jobs).some(isWatched)) return;
  watchTimer = setInterval(pollDownloads, 1000);
  pollDownloads();
}

function isWatched(job) {
  return job.source === 'browser' && (ACTIVE.has(job.status) || job.status === 'paused');
}

async function pollDownloads() {
  await ready;
  const watched = Object.values(jobs).filter(isWatched);
  if (!watched.length) {
    clearInterval(watchTimer);
    watchTimer = null;
    meters.clear();
    return;
  }
  for (const job of watched) {
    const [d] = await chrome.downloads.search({ id: job.downloadId }).catch(() => []);
    if (!d || d.state !== 'in_progress') continue; // onChanged reports the end
    if (!meters.has(job.id)) meters.set(job.id, speedMeter());
    const meter = meters.get(job.id);
    const total = d.totalBytes > 0 ? d.totalBytes : job.total || 0;
    const patch = { bytes: d.bytesReceived, total, progress: total ? d.bytesReceived / total : 0 };
    if (d.paused) {
      meter.reset();
      Object.assign(patch, { status: 'paused', speed: 0, eta: 0 });
    } else {
      const speed = meter.update(d.bytesReceived);
      Object.assign(patch, { status: 'downloading', speed, eta: etaSeconds(d.bytesReceived, total, speed) });
    }
    if (isWatched(jobs[job.id])) updateJob(job.id, patch); // it may have finished meanwhile
  }
}

async function cancelJob(jobId) {
  await ready;
  const job = jobs[jobId];
  if (!job) return;
  if (job.source === 'companion') hostRequest({ type: 'cancel', jobId, partials: job.partials || [] }).catch(() => {});
  else if (job.source !== 'browser') chrome.runtime.sendMessage({ target: 'offscreen', type: 'cancel', jobId }).catch(() => {});
  if (job.downloadId) chrome.downloads.cancel(job.downloadId).catch(() => {});
  updateJob(jobId, { status: 'cancelled', speed: 0, eta: 0 });
}

// Merging and saving can't be interrupted, so only downloading jobs pause.
async function pauseJob(jobId) {
  await ready;
  const job = jobs[jobId];
  if (job?.status !== 'downloading') return;
  if (job.source === 'companion') await hostRequest({ type: 'pause', jobId });
  else if (job.source === 'browser') await chrome.downloads.pause(job.downloadId);
  else await chrome.runtime.sendMessage({ target: 'offscreen', type: 'pause', jobId });
  meters.get(jobId)?.reset();
  updateJob(jobId, { status: 'paused', speed: 0, eta: 0 });
}

async function resumeJob(jobId) {
  await ready;
  const job = jobs[jobId];
  if (job?.status !== 'paused') return;
  if (job.source === 'companion') {
    updateJob(jobId, { status: 'starting' });
    runCompanionJob(job);
    return;
  }
  try {
    if (job.source === 'browser') {
      await chrome.downloads.resume(job.downloadId);
      watchDownloads();
    } else {
      const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'resume', jobId });
      if (!res?.ok) throw new Error('This download can no longer be resumed');
    }
    updateJob(jobId, { status: 'downloading' });
  } catch (e) {
    updateJob(jobId, { status: 'error', error: e.message });
  }
}

async function clearFinishedJobs() {
  await ready;
  for (const [id, job] of Object.entries(jobs)) if (FINISHED.has(job.status)) delete jobs[id];
  saveJobs();
}

// ---------------------------------------------------------------------------
// Companion app (native messaging host running yt-dlp)

const NATIVE_HOST = 'com.miracle.videodownloader';
let hostPort = null;
const hostRequests = new Map(); // reqId -> { resolve, reject }
const companionInfo = new Map(); // "url" or "url|login" -> info promise

function connectHost() {
  if (hostPort) return hostPort;
  const port = chrome.runtime.connectNative(NATIVE_HOST);
  port.onMessage.addListener(onHostMessage);
  port.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message || 'The companion app stopped unexpectedly';
    // "not found" = not installed; "forbidden" = installed for a different extension ID.
    const error = /not found|forbidden/i.test(reason) ? COMPANION_MISSING : reason;
    hostPort = null;
    for (const { reject } of hostRequests.values()) reject(new Error(error));
    hostRequests.clear();
    companionInfo.clear();
    for (const job of Object.values(jobs)) {
      if (job.source === 'companion' && ACTIVE.has(job.status)) updateJob(job.id, { status: 'error', error });
    }
  });
  hostPort = port;
  return port;
}

// `timeout` (ms) is for requests that should answer quickly; downloads only
// answer once finished, so they pass none.
function hostRequest(msg, timeout = 0) {
  return new Promise((resolve, reject) => {
    const reqId = crypto.randomUUID();
    hostRequests.set(reqId, { resolve, reject });
    if (timeout) {
      setTimeout(() => {
        if (hostRequests.delete(reqId)) reject(new Error('The companion app did not respond'));
      }, timeout);
    }
    try {
      connectHost().postMessage({ ...msg, reqId });
    } catch (e) {
      hostRequests.delete(reqId);
      reject(e);
    }
  });
}

function onHostMessage(msg) {
  if (msg.reqId) {
    const request = hostRequests.get(msg.reqId);
    hostRequests.delete(msg.reqId);
    if (msg.ok) request?.resolve(msg);
    else request?.reject(new Error(msg.error));
    return;
  }
  const job = jobs[msg.jobId];
  if (msg.type === 'progress') {
    // Lines yt-dlp printed just before it was stopped can arrive after a pause.
    if (job?.status === 'paused' || job?.status === 'cancelled') return;
    const { status, progress, bytes, total, totalEstimated, speed, eta } = msg;
    updateJob(msg.jobId, { status, progress, bytes, total, totalEstimated, speed, eta });
  } else if (msg.type === 'paused') {
    updateJob(msg.jobId, { status: 'paused', speed: 0, eta: 0, partials: msg.partials || [] });
  } else if (msg.type === 'done') {
    updateJob(msg.jobId, { status: 'done', progress: 1, file: msg.file, speed: 0, eta: 0, partials: undefined });
  } else if (msg.type === 'error') {
    updateJob(msg.jobId, { status: 'error', error: msg.error, speed: 0, eta: 0 });
  } else if (msg.type === 'cancelled') {
    updateJob(msg.jobId, { status: 'cancelled', speed: 0, eta: 0 });
  }
}

// The user's login for a site, shared with the companion app only when they
// ask for it ("Use my browser login"), for videos that need an account.
async function loginCookies(url) {
  const cookies = await chrome.cookies.getAll({ url });
  return cookies.length ? toNetscapeCookies(cookies) : undefined;
}

function getCompanionInfo(pageUrl, useLogin = false) {
  const target = companionTarget(pageUrl);
  if (!target) return Promise.reject(new Error('This page cannot be looked up'));
  const key = useLogin ? `${target.url}|login` : target.url;
  if (!companionInfo.has(key)) {
    const request = (async () => {
      const cookies = useLogin ? await loginCookies(target.url) : undefined;
      // Unknown pages can take a while: yt-dlp scans them for embedded players.
      return hostRequest({ type: 'info', url: target.url, cookies }, 90000);
    })();
    request.catch(() => companionInfo.delete(key));
    companionInfo.set(key, request);
  }
  return companionInfo.get(key);
}

async function startCompanionDownload({ pageUrl, height, audioOnly, useLogin }) {
  await ready;
  const info = await getCompanionInfo(pageUrl, useLogin);
  if (info.isLive) throw new Error('Live streams cannot be downloaded');
  const id = crypto.randomUUID();
  const label = audioOnly ? ' (audio)' : height ? ` (${height}p)` : '';
  jobs[id] = {
    id,
    source: 'companion',
    title: (info.title || `${info.site || 'Web'} video`) + label,
    status: 'starting',
    progress: 0,
    createdAt: Date.now(),
    useLogin: !!useLogin,
    request: { url: info.url, item: info.item || 0, height: height || 0, audioOnly: !!audioOnly },
  };
  saveJobs();
  runCompanionJob(jobs[id]);
  return { ok: true, jobId: id };
}

// Also used to resume: running the same download again makes yt-dlp continue
// from its partial files. The host answers only once it has stopped. Cookies
// are read fresh each time rather than kept with the job.
async function runCompanionJob(job) {
  try {
    const cookies = job.useLogin ? await loginCookies(job.request.url) : undefined;
    await hostRequest({ type: 'download', jobId: job.id, ...job.request, cookies });
  } catch (e) {
    updateJob(job.id, { status: 'error', error: e.message });
  }
}

// ---------------------------------------------------------------------------
// Messaging

function respond(promise, sendResponse) {
  promise.then(
    (result) => sendResponse(result ?? { ok: true }),
    (e) => sendResponse({ ok: false, error: e.message })
  );
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return;
  switch (msg.type) {
    case 'dom-videos':
      if (sender.tab) onDomVideos(sender.tab.id, msg.videos);
      return;
    case 'download':
      return respond(startDownload(msg), sendResponse);
    case 'cancel-job':
      return respond(cancelJob(msg.jobId), sendResponse);
    case 'pause-job':
      return respond(pauseJob(msg.jobId), sendResponse);
    case 'resume-job':
      return respond(resumeJob(msg.jobId), sendResponse);
    case 'clear-jobs':
      return respond(clearFinishedJobs(), sendResponse);
    case 'job-update':
      return respond(updateJob(msg.jobId, msg.patch), sendResponse);
    case 'job-ready':
      onJobReady(msg);
      sendResponse({ ok: true });
      return;
    case 'set-referer':
      return respond(setReferer(msg.hosts, msg.referer), sendResponse);
    case 'companion-info':
      return respond(getCompanionInfo(msg.pageUrl, msg.useLogin), sendResponse);
    case 'companion-download':
      return respond(startCompanionDownload(msg), sendResponse);
    case 'companion-update':
      companionInfo.clear();
      return respond(hostRequest({ type: 'update' }), sendResponse);
    case 'reveal':
      return respond(hostRequest({ type: 'reveal', path: msg.path }), sendResponse);
  }
});
