// Pages downloaded by the companion app (yt-dlp) instead of network detection.
// yt-dlp supports far more sites than listed here; these are the ones looked
// up automatically. Any other page can be looked up on request.

const YT_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i;
const YT_ID = /^[\w-]{11}$/;

// [site name, host pattern, path pattern of a page that shows one video]
const KNOWN_SITES = [
  ['X', /(^|\.)(x|twitter)\.com$/i, /\/status\/\d+/],
  ['TikTok', /(^|\.)tiktok\.com$/i, /\/(video|photo)\/\d+/],
  ['Vimeo', /(^|\.)vimeo\.com$/i, /^\/(\d+|.+\/videos?\/\d+|channels\/[^/]+\/\d+)/],
  ['Reddit', /(^|\.)reddit\.com$/i, /\/comments\//],
  ['Dailymotion', /(^|\.)dailymotion\.com$/i, /^\/video\//],
  ['Twitch', /(^|\.)twitch\.tv$/i, /\/(videos\/\d+|clip\/)|^\/[^/]+\/clip\//],
  ['SoundCloud', /(^|\.)soundcloud\.com$/i, /^\/[^/]+\/(?!sets\/|likes|following|followers|tracks)[^/]+/],
  ['Bilibili', /(^|\.)bilibili\.(com|tv)$/i, /\/video\//],
  ['Streamable', /(^|\.)streamable\.com$/i, /^\/\w+$/],
  ['Rumble', /(^|\.)rumble\.com$/i, /^\/v\w+-/],
];

// Canonical watch URL for a YouTube video page, or null for any other page.
export function youtubeVideoUrl(pageUrl) {
  let u;
  try {
    u = new URL(pageUrl);
  } catch {
    return null;
  }
  let id = null;
  if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
  else if (YT_HOSTS.test(u.hostname)) {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else id = u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1];
  }
  return id && YT_ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

// What the companion app would download for a page:
// { url, site, auto } where `auto` means "look it up as soon as the menu opens",
// or null for pages that aren't web pages at all.
export function companionTarget(pageUrl) {
  const youtube = youtubeVideoUrl(pageUrl);
  if (youtube) return { url: youtube, site: 'YouTube', auto: true };
  let u;
  try {
    u = new URL(pageUrl);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hash = '';
  const known = KNOWN_SITES.find(([, host, path]) => host.test(u.hostname) && path.test(u.pathname));
  return { url: u.href, site: known?.[0] || u.hostname.replace(/^www\./, ''), auto: !!known };
}

// Cookies in the Netscape format yt-dlp reads (--cookies), from chrome.cookies.getAll().
export function toNetscapeCookies(cookies) {
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of cookies) {
    const domain = c.hostOnly ? c.domain.replace(/^\./, '') : c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
    const expires = c.session || !c.expirationDate ? 0 : Math.floor(c.expirationDate);
    lines.push([domain, c.hostOnly ? 'FALSE' : 'TRUE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', expires, c.name, c.value].join('\t'));
  }
  return lines.join('\n') + '\n';
}

export const COMPANION_MISSING = 'companion-missing';
