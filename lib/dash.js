// DASH (MPD) manifest parser. Needs DOMParser, so it runs in the offscreen
// document rather than the service worker.

const children = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : []);
const child = (el, name) => children(el, name)[0] || null;

function parseIsoDuration(str) {
  const m = str?.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

function withBase(base, el) {
  const b = child(el, 'BaseURL');
  return b ? new URL(b.textContent.trim(), base).href : base;
}

function parseRange(str) {
  if (!str) return null;
  const [a, b] = str.split('-').map(Number);
  return { offset: a, length: b - a + 1 };
}

function contentType(el) {
  const ct = el.getAttribute('contentType');
  if (ct) return ct;
  const mime = el.getAttribute('mimeType') || '';
  return mime.split('/')[0] || '';
}

function fillTemplate(template, vars) {
  return template.replace(/\$(RepresentationID|Number|Time|Bandwidth)(?:%0(\d+)d)?\$|\$\$/g, (match, name, width) => {
    if (match === '$$') return '$';
    const value = String(vars[name] ?? '');
    return width ? value.padStart(Number(width), '0') : value;
  });
}

function templateSegments(templates, rep, repBase, periodDuration) {
  const attr = (name) => templates.find((t) => t.hasAttribute(name))?.getAttribute(name);
  const vars = { RepresentationID: rep.getAttribute('id'), Bandwidth: rep.getAttribute('bandwidth') };
  const timescale = Number(attr('timescale')) || 1;
  const startNumber = Number(attr('startNumber') ?? 1);
  const media = attr('media');
  const initialization = attr('initialization');
  const init = initialization ? { url: new URL(fillTemplate(initialization, vars), repBase).href } : null;
  const segments = [];
  const timeline = templates.map((t) => child(t, 'SegmentTimeline')).find(Boolean);

  if (timeline) {
    let time = 0;
    let number = startNumber;
    const end = periodDuration * timescale;
    for (const s of children(timeline, 'S')) {
      if (s.hasAttribute('t')) time = Number(s.getAttribute('t'));
      const d = Number(s.getAttribute('d'));
      let r = Number(s.getAttribute('r') || 0);
      if (r < 0) r = Math.max(0, Math.ceil((end - time) / d) - 1);
      for (let i = 0; i <= r; i++) {
        segments.push({ url: new URL(fillTemplate(media, { ...vars, Number: number++, Time: time }), repBase).href });
        time += d;
      }
    }
  } else {
    const duration = Number(attr('duration'));
    const count = duration ? Math.ceil((periodDuration * timescale) / duration) : 0;
    for (let i = 0; i < count; i++) {
      segments.push({ url: new URL(fillTemplate(media, { ...vars, Number: startNumber + i }), repBase).href });
    }
  }
  return { init, segments };
}

function listSegments(list, repBase) {
  const initEl = child(list, 'Initialization');
  const init = initEl
    ? {
        url: new URL(initEl.getAttribute('sourceURL') || '', repBase).href,
        byterange: parseRange(initEl.getAttribute('range')),
      }
    : null;
  const segments = children(list, 'SegmentURL').map((s) => ({
    url: new URL(s.getAttribute('media') || '', repBase).href,
    byterange: parseRange(s.getAttribute('mediaRange')),
  }));
  return { init, segments };
}

export function parseMpd(text, mpdUrl) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const mpd = doc.documentElement;
  if (mpd.localName !== 'MPD') throw new Error('Not a DASH manifest');
  const period = child(mpd, 'Period');
  if (!period) throw new Error('DASH manifest has no Period');

  const live = mpd.getAttribute('type') === 'dynamic';
  const duration = parseIsoDuration(mpd.getAttribute('mediaPresentationDuration'));
  const periodDuration = parseIsoDuration(period.getAttribute('duration')) || duration;
  const periodBase = withBase(withBase(mpdUrl, mpd), period);
  const video = [];
  const audio = [];

  for (const set of children(period, 'AdaptationSet')) {
    const setBase = withBase(periodBase, set);
    const setDrm = children(set, 'ContentProtection').length > 0;
    for (const rep of children(set, 'Representation')) {
      const type = contentType(rep) || contentType(set);
      if (type !== 'video' && type !== 'audio') continue;
      const attr = (name) => rep.getAttribute(name) ?? set.getAttribute(name);
      const repBase = withBase(setBase, rep);
      const templates = [rep, set, period].map((el) => child(el, 'SegmentTemplate')).filter(Boolean);
      const list = child(rep, 'SegmentList') || child(set, 'SegmentList');
      const { init, segments } = templates.length
        ? templateSegments(templates, rep, repBase, periodDuration)
        : list
          ? listSegments(list, repBase)
          : { init: null, segments: [{ url: repBase }] }; // SegmentBase / plain BaseURL: one whole file

      (type === 'video' ? video : audio).push({
        id: rep.getAttribute('id'),
        bandwidth: Number(attr('bandwidth')) || 0,
        width: Number(attr('width')) || 0,
        height: Number(attr('height')) || 0,
        codecs: attr('codecs') || '',
        lang: set.getAttribute('lang') || '',
        drm: setDrm || children(rep, 'ContentProtection').length > 0,
        init,
        segments,
      });
    }
  }

  video.sort((a, b) => b.bandwidth - a.bandwidth);
  audio.sort((a, b) => b.bandwidth - a.bandwidth);
  return { live, duration, video, audio, drm: [...video, ...audio].some((r) => r.drm) };
}

// Compact form stored with the detected item (segment lists can be huge).
export function summarizeMpd(mpd) {
  const strip = ({ id, bandwidth, width, height, codecs, lang }) => ({ id, bandwidth, width, height, codecs, lang });
  return { live: mpd.live, duration: mpd.duration, drm: mpd.drm, video: mpd.video.map(strip), audio: mpd.audio.map(strip) };
}
