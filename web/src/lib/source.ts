/** Where an imported recipe came from, ready to put on screen. Null when there is nothing safe to link to. */
export type SourceLink = { href: string; host: string; label: string; video: boolean };

// Posts on these sites are a video with the recipe in the caption: the page is worth watching, not reading.
const VIDEO_HOSTS = ['facebook.com', 'instagram.com', 'tiktok.com', 'youtube.com', 'youtu.be'];

export function sourceLink(r: { sourceUrl: string | null; sourceName: string | null }): SourceLink | null {
  if (!r.sourceUrl) return null;
  let url: URL;
  try {
    url = new URL(r.sourceUrl);
  } catch {
    return null;
  }
  // Anything but http(s) (javascript:, data:) must never become a link the page will open.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const video = VIDEO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  const name = r.sourceName ?? host;
  return { href: url.href, host, label: video ? `Watch on ${name}` : `View original at ${name}`, video };
}
