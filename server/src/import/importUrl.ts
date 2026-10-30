import * as cheerio from 'cheerio';
import { AiRequestError, type AiClient, type ProviderErrorCode, type ProviderName } from '../ai/client.js';
import type { ImageStore } from '../images/store.js';
import type { RecipeDraft } from '../recipes/schema.js';
import { findImageUrl, parseRecipeJsonLd } from './jsonld.js';

export const MAX_PAGE_TEXT_CHARS = 20_000;

export type ImportDeps = {
  fetchPage: (url: string) => Promise<{ html: string; finalUrl: string }>;
  fetchBytes: (url: string) => Promise<{ bytes: Buffer; contentType: string; finalUrl: string }>;
  ai?: AiClient;
  images: ImageStore;
};

export type ImportResult = {
  draft: RecipeDraft;
  usedAi: boolean;
  usable: boolean;
  /** Which AI answered (only when usedAi). Never part of the draft, so it is never saved. */
  provider?: ProviderName;
  model?: string;
  /** Set when the AI fallback failed because of the provider (credit, key, busy...), so the page can say why. */
  aiError?: { error: string; code: ProviderErrorCode };
};

/** Visible text of the page's main content, whitespace collapsed and capped. */
export function extractVisibleText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, template, nav, footer, aside, form, svg, iframe, [hidden], [aria-hidden="true"]').remove();
  const root = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');
  return root.text().replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_TEXT_CHARS);
}

/**
 * Text the page carries in its own metadata (og:/twitter: tags, the oembed link's title). Social video posts render
 * the recipe with JavaScript, so the fetched HTML has no visible text, but the caption is in these tags.
 * Newlines are kept: a caption's line breaks usually separate the ingredients and the steps.
 */
export function extractMetaText(html: string): string {
  const $ = cheerio.load(html);
  const candidates = [
    $('link[type="application/json+oembed"], link[type="text/xml+oembed"]').attr('title'),
    $('meta[property="og:title"]').attr('content') ?? $('meta[name="twitter:title"]').attr('content'),
    $('meta[property="og:description"]').attr('content') ??
      $('meta[name="description"]').attr('content') ??
      $('meta[name="twitter:description"]').attr('content'),
  ]
    .map((t) => t?.replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() ?? '')
    .filter((t) => t !== '');
  // Social posts repeat the caption across tags, each cut short and some with a "706K views ·" prefix, so a copy is
  // recognised by a run from its middle appearing in a longer candidate rather than by the whole string matching.
  const flat = (t: string) => t.replace(/\s+/g, ' ');
  // The probe is the tail, since a prefix is only ever added at the front and the cut is only ever at the end.
  const core = (t: string) => flat(t).replace(/(\.{3}|…)\s*$/, '').trim().slice(-25);
  const kept = candidates.filter((t, i) => !candidates.some((o, j) => j !== i && o.length > t.length && flat(o).includes(core(t))));
  return [...new Set(kept)].join('\n\n').slice(0, MAX_PAGE_TEXT_CHARS);
}

const hostName = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./i, '');
  } catch {
    return u;
  }
};

async function downloadImage(html: string, finalUrl: string, deps: ImportDeps): Promise<string[]> {
  try {
    const url = findImageUrl(html, finalUrl);
    if (!url) return [];
    const { bytes } = await deps.fetchBytes(url);
    return [await deps.images.save(bytes)];
  } catch {
    return []; // a missing image must never fail the import
  }
}

export async function importFromUrl(url: string, deps: ImportDeps): Promise<ImportResult> {
  const { html, finalUrl } = await deps.fetchPage(url);
  const sourceName = hostName(finalUrl);
  const source = { origin: 'other' as const, sourceUrl: finalUrl, sourceName };

  const ld = parseRecipeJsonLd(html);
  if (ld && (ld.ingredients.length > 0 || ld.steps.length > 0)) {
    const imageIds = await downloadImage(html, finalUrl, deps);
    return { draft: { ...ld, ...source, imageIds, gaps: [] }, usedAi: false, usable: true };
  }

  // A page whose body renders in the browser gives no visible text; its metadata may still hold the whole recipe.
  const visible = extractVisibleText(html);
  const meta = extractMetaText(html);
  const text = meta.length > visible.length ? meta : visible;
  let aiError: ImportResult['aiError'];
  if (deps.ai && text !== '') {
    try {
      const { draft: ai, provider, model } = await deps.ai.extractRecipe({ kind: 'page', text, sourceUrl: finalUrl });
      if (ai.ingredients.length > 0 || ai.steps.length > 0) {
        const imageIds = await downloadImage(html, finalUrl, deps);
        return { draft: { ...ai, ...source, imageIds }, usedAi: true, usable: true, provider, model };
      }
    } catch (err) {
      if (err instanceof AiRequestError) aiError = { error: err.message, code: err.code };
      // fall through to the unusable draft
    }
  }

  // The editor needs a draft that passes RecipeInputSchema (title is required), so the hostname stands in as the title.
  const empty: RecipeDraft = {
    title: sourceName, description: null, ...source, servings: null, prepMinutes: null, cookMinutes: null,
    ingredients: [], steps: [], notes: null, tags: [], imageIds: [], gaps: [],
  };
  return { draft: empty, usedAi: false, usable: false, ...(aiError ? { aiError } : {}) };
}
