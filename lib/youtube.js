// YouTube videos are downloaded by the companion app (yt-dlp), keyed by page URL.

const YT_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i;
const ID = /^[\w-]{11}$/;

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
  return id && ID.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
}

export const COMPANION_MISSING = 'companion-missing';
