import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AiClient } from '../ai/client.js';
import { RecipeDraftSchema, RecipeInputSchema, type RecipeDraft } from '../recipes/schema.js';
import { extractVisibleText, importFromUrl } from './importUrl.js';

const fixture = (n: string) => readFileSync(new URL(`../../test-fixtures/${n}`, import.meta.url), 'utf8');
const aiDraft: RecipeDraft = {
  title: 'Nan soup', description: null, origin: 'mine', sourceName: null, sourceUrl: null, servings: null, prepMinutes: null, cookMinutes: 20,
  ingredients: [{ group: null, quantity: null, unit: null, item: 'onion', note: null }], steps: ['Fry an onion'], notes: null, tags: [], imageIds: [], gaps: ['servings'],
};
const page = (name: string, finalUrl = 'https://www.bbcgoodfood.com/recipes/easy-pancakes') => vi.fn(async () => ({ html: fixture(name), finalUrl }));
const fakeAi = (impl?: () => Promise<RecipeDraft>) => ({ extractRecipe: vi.fn(impl ?? (async () => aiDraft)) }) satisfies AiClient;
const images = () => ({ save: vi.fn(async () => 'a'.repeat(64) + '.jpg'), path: vi.fn(), dir: '/x' });
const img = (over: Partial<{ fetchBytes: never }> = {}) => ({ fetchBytes: vi.fn(async () => ({ bytes: Buffer.from('img'), contentType: 'image/jpeg', finalUrl: 'x' })), ...over });

describe('importFromUrl', () => {
  it('uses JSON-LD without calling the AI and saves the image', async () => {
    const ai = fakeAi();
    const store = images();
    const b = img();
    const r = await importFromUrl('https://bbcgoodfood.com/x', { fetchPage: page('bbc-goodfood.html'), fetchBytes: b.fetchBytes, ai, images: store });
    expect(ai.extractRecipe).not.toHaveBeenCalled();
    expect(r).toMatchObject({ usedAi: false, usable: true });
    expect(r.draft).toMatchObject({ title: 'Easy pancakes', origin: 'other', sourceUrl: 'https://www.bbcgoodfood.com/recipes/easy-pancakes', sourceName: 'bbcgoodfood.com', gaps: [], imageIds: ['a'.repeat(64) + '.jpg'] });
    expect(b.fetchBytes).toHaveBeenCalledWith('https://images.immediate.co.uk/pancakes.jpg');
    expect(RecipeDraftSchema.safeParse(r.draft).success).toBe(true);
  });
  it('a failed image download does not fail the import', async () => {
    for (const failing of [{ fetchBytes: vi.fn(async () => { throw new Error('boom'); }) }, null]) {
      const store = images();
      if (!failing) store.save.mockRejectedValue(new Error('not an image'));
      const r = await importFromUrl('https://x.test', { fetchPage: page('bbc-goodfood.html'), fetchBytes: failing?.fetchBytes ?? img().fetchBytes, ai: undefined, images: store });
      expect(r.usable).toBe(true);
      expect(r.draft.imageIds).toEqual([]);
    }
  });
  it('falls back to the AI on visible text when there is no JSON-LD', async () => {
    const ai = fakeAi();
    const r = await importFromUrl('https://x.test', { fetchPage: page('no-recipe.html', 'https://www.nan.example/soup'), fetchBytes: img().fetchBytes, ai, images: images() });
    expect(r).toMatchObject({ usedAi: true, usable: true });
    const arg = ai.extractRecipe.mock.calls[0]![0];
    expect(arg.kind).toBe('page');
    expect(arg.sourceUrl).toBe('https://www.nan.example/soup');
    expect(arg.text).toContain('Fry an onion');
    expect(arg.text).not.toContain('tracking');
    expect(r.draft).toMatchObject({ title: 'Nan soup', origin: 'other', sourceName: 'nan.example', sourceUrl: 'https://www.nan.example/soup', gaps: ['servings'], imageIds: [] });
  });
  it('is not usable without an AI client', async () => {
    const r = await importFromUrl('https://x.test', { fetchPage: page('no-recipe.html', 'https://www.nan.example/soup'), fetchBytes: img().fetchBytes, ai: undefined, images: images() });
    expect(r.usable).toBe(false);
    expect(r.usedAi).toBe(false);
    expect(r.draft).toMatchObject({ sourceUrl: 'https://www.nan.example/soup', sourceName: 'nan.example', title: 'nan.example', origin: 'other', ingredients: [], steps: [], gaps: [], imageIds: [] });
    expect(RecipeInputSchema.safeParse(r.draft).success).toBe(true);
  });
  it('is not usable when the AI throws, or finds nothing', async () => {
    for (const impl of [async () => { throw new Error('down'); }, async () => ({ ...aiDraft, ingredients: [], steps: [] })]) {
      const r = await importFromUrl('https://x.test', { fetchPage: page('no-recipe.html', 'https://nan.example/soup'), fetchBytes: img().fetchBytes, ai: fakeAi(impl), images: images() });
      expect(r.usable).toBe(false);
      expect(r.draft).toMatchObject({ sourceUrl: 'https://nan.example/soup', title: 'nan.example', ingredients: [] });
    }
  });
  it('treats an empty JSON-LD recipe as a miss', async () => {
    const html = '<script type="application/ld+json">{"@type":"Recipe","name":"Empty"}</script><p>Boil water.</p>';
    const ai = fakeAi();
    const r = await importFromUrl('https://x.test', { fetchPage: async () => ({ html, finalUrl: 'https://x.test/' }), fetchBytes: img().fetchBytes, ai, images: images() });
    expect(ai.extractRecipe).toHaveBeenCalled();
    expect(r.usedAi).toBe(true);
  });
  it('does not call the AI for a page with no text', async () => {
    const ai = fakeAi();
    const r = await importFromUrl('https://x.test', { fetchPage: async () => ({ html: '<script>x</script>', finalUrl: 'https://x.test/' }), fetchBytes: img().fetchBytes, ai, images: images() });
    expect(ai.extractRecipe).not.toHaveBeenCalled();
    expect(r.usable).toBe(false);
  });
  it('propagates fetch failures', async () => {
    await expect(importFromUrl('https://x.test', { fetchPage: async () => { throw new Error('nope'); }, fetchBytes: img().fetchBytes, images: images() })).rejects.toThrow('nope');
  });
});

describe('extractVisibleText', () => {
  it('drops script/style/nav/footer/aside and collapses whitespace', () => {
    const t = extractVisibleText(fixture('no-recipe.html'));
    expect(t).toContain("My nan's soup");
    expect(t).toContain('Fry an onion, add stock and simmer for 20 minutes.');
    for (const bad of ['Home About', 'Ads', '(c) me', 'tracking', 'color:red']) expect(t).not.toContain(bad);
  });
  it('caps at 20k chars', () => {
    expect(extractVisibleText(`<p>${'a '.repeat(30_000)}</p>`).length).toBeLessThanOrEqual(20_000);
  });
});
