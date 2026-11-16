// Posts on these sites are a video with the recipe in the caption: the page is worth watching, not reading.
export const VIDEO_HOSTS = ['facebook.com', 'instagram.com', 'tiktok.com', 'youtube.com', 'youtu.be'];

/** The platform's own name, for a post whose creator is not known. */
export const PLATFORM_LABELS: Record<string, string> = {
  'facebook.com': 'Facebook',
  'instagram.com': 'Instagram',
  'tiktok.com': 'TikTok',
  'youtube.com': 'YouTube',
  'youtu.be': 'YouTube',
};

/** The VIDEO_HOSTS entry this host is (or is a subdomain of), else null. */
export function videoHostOf(host: string): string | null {
  return VIDEO_HOSTS.find((h) => host === h || host.endsWith(`.${h}`)) ?? null;
}
