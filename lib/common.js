// Helpers shared by the service worker, popup and offscreen document.

// Groups a tab's detected items into the entries shown in the popup:
// - variant/audio playlists of an HLS master are folded into the master,
// - separate video and audio files of the same social video become one entry
//   (several video qualities plus the audio file they get merged with).
export function buildEntries(items) {
  const hlsChildren = new Set();
  for (const item of items) {
    if (item.hls?.type !== 'master') continue;
    for (const v of item.hls.variants) hlsChildren.add(v.url);
    for (const a of item.hls.audio || []) hlsChildren.add(a);
  }

  const entries = [];
  const groups = new Map();
  for (const item of items) {
    if (hlsChildren.has(item.url)) continue;
    if (item.kind !== 'file' || !item.group) {
      entries.push({ key: item.id, videos: [item], audio: null, latest: item.detectedAt });
      continue;
    }
    let group = groups.get(item.group);
    if (!group) {
      group = { key: item.group, videos: [], audio: null, latest: 0 };
      groups.set(item.group, group);
      entries.push(group);
    }
    if (item.track === 'audio') group.audio = item;
    else group.videos.push(item);
    group.latest = Math.max(group.latest, item.detectedAt);
  }

  for (const group of groups.values()) {
    if (!group.videos.length) {
      group.videos = [group.audio];
      group.audio = null;
    }
  }
  for (const entry of entries) entry.videos.sort((a, b) => (b.height || 0) - (a.height || 0));
  return entries.sort((a, b) => b.latest - a.latest);
}

export function formatBytes(n) {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function formatSpeed(bytesPerSecond) {
  return bytesPerSecond > 0 ? `${formatBytes(bytesPerSecond)}/s` : '';
}

// Download speed (bytes/second) averaged over the last few seconds, from a
// running byte count. reset() after a pause so the gap isn't counted.
export function speedMeter(windowMs = 4000) {
  let samples = [];
  return {
    update(bytes, now = Date.now()) {
      samples.push([now, bytes]);
      while (samples.length > 2 && now - samples[0][0] > windowMs) samples.shift();
      const [t0, b0] = samples[0];
      return now > t0 ? Math.max(0, ((bytes - b0) * 1000) / (now - t0)) : 0;
    },
    reset() {
      samples = [];
    },
  };
}

// Seconds left, or 0 when it can't be worked out.
export function etaSeconds(bytes, total, speed) {
  return total > bytes && speed > 0 ? (total - bytes) / speed : 0;
}

export function formatDuration(sec) {
  if (!sec || !isFinite(sec)) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export function sanitizeFilename(name) {
  let s = String(name || '')
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120)
    .trim();
  if (!s) s = 'video';
  if (RESERVED.test(s)) s = `_${s}`;
  return s;
}
