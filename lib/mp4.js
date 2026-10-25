// Reads just enough of an MP4's header boxes to tell which tracks it carries.
// Works on a truncated buffer (the first ~128 KB of the file).

function* boxes(view, start, end) {
  let pos = start;
  while (pos + 8 <= end) {
    let size = view.getUint32(pos);
    const type = String.fromCharCode(
      view.getUint8(pos + 4),
      view.getUint8(pos + 5),
      view.getUint8(pos + 6),
      view.getUint8(pos + 7)
    );
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) return;
      size = Number(view.getBigUint64(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header) return;
    yield { type, start: pos + header, end: Math.min(pos + size, end), complete: pos + size <= end };
    pos += size;
  }
}

function find(view, parent, type) {
  for (const box of boxes(view, parent.start, parent.end)) if (box.type === type) return box;
  return null;
}

function parseTrak(view, trak) {
  const track = {};
  const tkhd = find(view, trak, 'tkhd');
  if (tkhd) {
    const off = tkhd.start + (view.getUint8(tkhd.start) === 1 ? 88 : 76);
    if (off + 8 <= tkhd.end) {
      track.width = view.getUint32(off) >>> 16;
      track.height = view.getUint32(off + 4) >>> 16;
    }
  }
  const mdia = find(view, trak, 'mdia');
  const hdlr = mdia && find(view, mdia, 'hdlr');
  if (hdlr && hdlr.start + 12 <= hdlr.end) {
    track.handler = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + hdlr.start + 8, 4));
  }
  return track;
}

function mvhdDuration(view, mvhd) {
  const v1 = view.getUint8(mvhd.start) === 1;
  const timescale = view.getUint32(mvhd.start + (v1 ? 20 : 12));
  const duration = v1 ? Number(view.getBigUint64(mvhd.start + 24)) : view.getUint32(mvhd.start + 16);
  return timescale && duration && duration !== 0xffffffff ? duration / timescale : 0;
}

// Fragmented files (DASH) usually have a zero mvhd duration; the segment index has the real one.
function sidxDuration(view, sidx) {
  const v1 = view.getUint8(sidx.start) === 1;
  const timescale = view.getUint32(sidx.start + 8);
  let pos = sidx.start + (v1 ? 28 : 20);
  if (pos + 4 > sidx.end || !timescale) return 0;
  const count = view.getUint16(pos + 2);
  pos += 4;
  let total = 0;
  for (let i = 0; i < count && pos + 12 <= sidx.end; i++, pos += 12) total += view.getUint32(pos + 4);
  return total / timescale;
}

// Returns { hasVideo, hasAudio, width, height, duration } or null if no movie header was found.
export function probeMp4(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const root = { start: 0, end: bytes.byteLength };
  let info = null;
  let duration = 0;
  for (const box of boxes(view, root.start, root.end)) {
    if (box.type === 'moov') {
      info = { hasVideo: false, hasAudio: false, width: 0, height: 0, duration: 0 };
      const mvhd = find(view, box, 'mvhd');
      if (mvhd) duration = mvhdDuration(view, mvhd);
      for (const child of boxes(view, box.start, box.end)) {
        if (child.type !== 'trak') continue;
        const track = parseTrak(view, child);
        if (track.handler === 'vide') {
          info.hasVideo = true;
          info.width ||= track.width;
          info.height ||= track.height;
        } else if (track.handler === 'soun') {
          info.hasAudio = true;
        }
      }
    } else if (box.type === 'sidx' && !duration) {
      duration = sidxDuration(view, box);
    } else if (box.type === 'moof') {
      break;
    }
  }
  if (info) info.duration = duration;
  return info;
}

// Identifies container format from the first bytes of a file.
export function sniffContainer(bytes) {
  if (bytes[0] === 0x47 && (bytes.length < 189 || bytes[188] === 0x47)) return 'ts';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  const type = String.fromCharCode(...bytes.subarray(4, 8));
  if (['ftyp', 'styp', 'moov', 'moof', 'sidx', 'free'].includes(type)) return 'mp4';
  return 'bin';
}
