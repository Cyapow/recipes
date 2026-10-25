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

  const text = extractVisibleText(html);
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
