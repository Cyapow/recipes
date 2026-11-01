import type { ImageStore } from '../images/store.js';
import { findImageUrl } from './jsonld.js';

/**
 * A described recipe can still have come from somewhere. When a social post keeps the recipe in its comments the
 * page is no use to the importer, so people paste the text in themselves and put the link above it — and then the
 * recipe has no photo, while every imported one does. If the description carries a link, the page behind it still
 * has its picture and its name, so we take those and leave the recipe itself exactly as the AI read it.
 */

export type SourceDeps = {
  fetchPage: (url: string) => Promise<{ html: string; finalUrl: string }>;
  fetchBytes: (url: string) => Promise<{ bytes: Buffer; contentType: string; finalUrl: string }>;
  images: ImageStore;
};

export type DescribedSource = { imageIds: string[]; sourceUrl: string; sourceName: string };

// A real link, not an @handle, a #tag or a bare domain someone typed. Trailing punctuation is sentence, not URL.
const LINK = /\bhttps?:\/\/[^\s<>"']+/i;

export function firstLink(text: string): string | null {
  const m = LINK.exec(text);
  if (!m) return null;
  const raw = m[0].replace(/[.,;:!?)\]}'"]+$/, '');
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

const hostName = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./i, '');
  } catch {
    return u;
  }
};

/** The photo and source behind the first link in a description, or null when there is none to be had. */
export async function sourceFromText(text: string, deps: SourceDeps): Promise<DescribedSource | null> {
  const link = firstLink(text);
  if (!link) return null;
  try {
    const { html, finalUrl } = await deps.fetchPage(link);
    let imageIds: string[] = [];
    try {
      const image = findImageUrl(html, finalUrl);
      if (image) imageIds = [await deps.images.save((await deps.fetchBytes(image)).bytes)];
    } catch {
      // the page is still worth recording without its picture
    }
    return { imageIds, sourceUrl: finalUrl, sourceName: hostName(finalUrl) };
  } catch {
    return null; // a page we cannot reach must never cost the user their described recipe
  }
}
