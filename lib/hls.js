// Minimal HLS (m3u8) playlist parser.

function parseAttrs(str) {
  const attrs = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(str))) attrs[m[1]] = m[2].replace(/^"|"$/g, '');
  return attrs;
}

// "length[@offset]"; without an offset the range continues from the previous one.
function parseByteRange(str, prevEnd) {
  const [len, off] = str.split('@');
  const length = parseInt(len, 10);
  const offset = off !== undefined ? parseInt(off, 10) : prevEnd;
  return { offset, length };
}

export function parsePlaylist(text, baseUrl) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines[0]?.startsWith('#EXTM3U')) throw new Error('Not an M3U8 playlist');
  const resolve = (u) => new URL(u, baseUrl).href;

  if (lines.some((l) => l.startsWith('#EXT-X-STREAM-INF:'))) {
    const variants = [];
    const audio = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const a = parseAttrs(line.slice(18));
        let j = i + 1;
        while (j < lines.length && lines[j].startsWith('#')) j++;
        if (j < lines.length) {
          variants.push({
            url: resolve(lines[j]),
            bandwidth: Number(a.BANDWIDTH) || 0,
            resolution: a.RESOLUTION || '',
            codecs: a.CODECS || '',
            audioGroup: a.AUDIO || null,
          });
        }
        i = j;
      } else if (line.startsWith('#EXT-X-MEDIA:')) {
        const a = parseAttrs(line.slice(13));
        if (a.TYPE === 'AUDIO' && a.URI) {
          audio.push({
            url: resolve(a.URI),
            groupId: a['GROUP-ID'],
            name: a.NAME,
            language: a.LANGUAGE,
            isDefault: a.DEFAULT === 'YES',
          });
        }
      }
    }
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    return { type: 'master', variants, audio };
  }

  const segments = [];
  let mediaSeq = 0;
  let key = null;
  let map = null;
  let segDuration = 0;
  let byterange = null;
  let lastByteEnd = 0;
  let duration = 0;
  let ended = false;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSeq = parseInt(line.slice(22), 10) || 0;
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const a = parseAttrs(line.slice(11));
      key =
        a.METHOD === 'NONE'
          ? null
          : { method: a.METHOD, uri: a.URI ? resolve(a.URI) : null, iv: a.IV || null, keyformat: a.KEYFORMAT || null };
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const a = parseAttrs(line.slice(11));
      map = { url: resolve(a.URI), byterange: a.BYTERANGE ? parseByteRange(a.BYTERANGE, 0) : null };
    } else if (line.startsWith('#EXTINF:')) {
      segDuration = parseFloat(line.slice(8)) || 0;
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      byterange = parseByteRange(line.slice(17), lastByteEnd);
    } else if (line === '#EXT-X-ENDLIST') {
      ended = true;
    } else if (!line.startsWith('#')) {
      segments.push({ url: resolve(line), duration: segDuration, seq: mediaSeq + segments.length, key, map, byterange });
      if (byterange) lastByteEnd = byterange.offset + byterange.length;
      duration += segDuration;
      segDuration = 0;
      byterange = null;
    }
  }

  return { type: 'media', segments, duration, live: !ended };
}

// The separate audio rendition a variant plays with, if its audio isn't muxed in.
export function audioForVariant(master, variant) {
  if (!variant.audioGroup) return null;
  const group = master.audio.filter((a) => a.groupId === variant.audioGroup);
  return group.find((a) => a.isDefault) || group[0] || null;
}

// Plain AES-128 is regular HLS encryption; anything else (SAMPLE-AES, FairPlay,
// Widevine key formats) is DRM, which this extension deliberately does not touch.
export function isDrmProtected(playlist) {
  return playlist.segments.some(
    (s) => s.key && (s.key.method !== 'AES-128' || (s.key.keyformat && s.key.keyformat !== 'identity'))
  );
}
