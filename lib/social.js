// Facebook / Instagram video CDN handling.
//
// Their players fetch each MP4 in pieces, encoding the range in the URL
// (bytestart/byteend). Dropping those parameters yields the complete file.
// Video and audio are usually separate files that need merging.

const SOCIAL_HOSTS = [/(^|\.)fbcdn\.net$/i, /(^|\.)cdninstagram\.com$/i];
const RANGE_PARAMS = ['bytestart', 'byteend'];

export function isSocialHost(url) {
  try {
    const host = new URL(url).hostname;
    return SOCIAL_HOSTS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

export function normalizeSocialUrl(url) {
  const u = new URL(url);
  for (const p of RANGE_PARAMS) u.searchParams.delete(p);
  return u.href;
}

// The `efg` parameter is base64 JSON describing the encode; it usually
// carries an asset id shared by a video's video and audio files.
export function socialHints(url) {
  try {
    const efg = new URL(url).searchParams.get('efg');
    if (!efg) return {};
    const b64 = efg.replace(/-/g, '+').replace(/_/g, '/');
    const data = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    const asset = data.xpv_asset_id ?? data.video_id ?? data.asset_id;
    const tag = String(data.vencode_tag || '');
    return {
      group: asset ? `asset:${asset}` : undefined,
      track: /audio/i.test(tag) ? 'audio' : undefined,
    };
  } catch {
    return {};
  }
}
