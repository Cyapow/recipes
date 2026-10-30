import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AiRefusedError, AiRequestError, type AiClient } from '../ai/client.js';
import { RecipeDraftSchema, RecipeInputSchema, type RecipeDraft } from '../recipes/schema.js';
import { extractMetaText, extractVisibleText, importFromUrl } from './importUrl.js';

const fixture = (n: string) => readFileSync(new URL(`../../test-fixtures/${n}`, import.meta.url), 'utf8');
const aiDraft: RecipeDraft = {
  title: 'Nan soup', description: null, origin: 'mine', sourceName: null, sourceUrl: null, servings: null, prepMinutes: null, cookMinutes: 20,
  ingredients: [{ group: null, quantity: null, unit: null, item: 'onion', note: null }], steps: [{ text: 'Fry an onion', imageId: null, ingredients: [] }], notes: null, tags: [], imageIds: [], gaps: ['servings'],
};
const page = (name: string, finalUrl = 'https://www.bbcgoodfood.com/recipes/easy-pancakes') => vi.fn(async () => ({ html: fixture(name), finalUrl }));
const extraction = (draft: RecipeDraft) => ({ draft, provider: 'gemini' as const, model: 'g-1' });
const fakeAi = (impl?: () => Promise<ReturnType<typeof extraction>>) => ({ extractRecipe: vi.fn(impl ?? (async () => extraction(aiDraft))) }) satisfies AiClient;
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
    expect(r).toMatchObject({ provider: 'gemini', model: 'g-1' });
    expect(r.draft).not.toHaveProperty('provider');
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
    for (const impl of [async () => { throw new Error('down'); }, async () => extraction({ ...aiDraft, ingredients: [], steps: [] })]) {
      const r = await importFromUrl('https://x.test', { fetchPage: page('no-recipe.html', 'https://nan.example/soup'), fetchBytes: img().fetchBytes, ai: fakeAi(impl), images: images() });
      expect(r.usable).toBe(false);
      expect(r.draft).toMatchObject({ sourceUrl: 'https://nan.example/soup', title: 'nan.example', ingredients: [] });
    }
  });
  it('reports a provider failure so the page can explain it, still returning an editable draft', async () => {
    const ai = fakeAi(async () => { throw new AiRequestError('no_credit'); });
    const r = await importFromUrl('https://x.test', { fetchPage: page('no-recipe.html', 'https://nan.example/soup'), fetchBytes: img().fetchBytes, ai, images: images() });
    expect(r.usable).toBe(false);
    expect(r.aiError).toEqual({ error: 'The AI account is out of credit. Add credit or switch provider.', code: 'no_credit' });
    expect(r.draft.title).toBe('nan.example');
  });
  it('does not report refusals or invalid output as a provider failure', async () => {
    const ai = fakeAi(async () => { throw new AiRefusedError(); });
    const r = await importFromUrl('https://x.test', { fetchPage: page('no-recipe.html', 'https://nan.example/soup'), fetchBytes: img().fetchBytes, ai, images: images() });
    expect(r.aiError).toBeUndefined();
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

describe('extractMetaText', () => {
  const social = (caption: string, short = caption.slice(0, 40)) => `<html><head>
    <link rel="alternate" type="application/json+oembed" href="/o" title="${caption}" />
    <meta property="og:title" content="706K views · ${short}" />
    <meta property="og:description" content="${short}" />
    </head><body><div id="root"></div></body></html>`;

  it('takes the caption a JS-rendered post keeps in its tags, newlines and all', () => {
    const caption = 'Mini pizzas\n\n330g plain flour\n1 tbsp olive oil\n\nPlace the flour in a bowl. Add the oil.';
    const t = extractMetaText(social(caption));
    expect(t).toContain('330g plain flour');
    expect(t).toContain('\n');
    expect(t.split('330g plain flour').length - 1, 'the truncated copies are dropped').toBe(1);
  });

  it('keeps a title and a description that say different things', () => {
    const t = extractMetaText('<html><head><meta property="og:title" content="Nan soup" /><meta name="description" content="Fry an onion." /></head></html>');
    expect(t).toBe('Nan soup\n\nFry an onion.');
  });

  it('is empty for a page with no metadata, and capped', () => {
    expect(extractMetaText('<html><body><p>hi</p></body></html>')).toBe('');
    expect(extractMetaText(`<html><head><meta property="og:description" content="${'a '.repeat(30_000)}" /></head></html>`).length).toBeLessThanOrEqual(20_000);
  });
});

describe('a page that renders in the browser', () => {
  const html = `<html><head>
    <link rel="alternate" type="application/json+oembed" href="/o" title="Mini pizzas\n\n330g plain flour\n\nPlace the flour in a bowl." />
    <meta property="og:image" content="https://cdn.test/thumb.jpg" />
    </head><body><div id="root"></div></body></html>`;

  it('sends the metadata caption to the AI and imports it', async () => {
    const ai = fakeAi();
    const b = img();
    const r = await importFromUrl('https://social.test/r/1', { fetchPage: vi.fn(async () => ({ html, finalUrl: 'https://social.test/reel/1' })), fetchBytes: b.fetchBytes, ai, images: images() });
    expect(ai.extractRecipe).toHaveBeenCalledOnce();
    const sent = ai.extractRecipe.mock.calls[0][0] as { kind: string; text: string };
    expect(sent.kind).toBe('page');
    expect(sent.text).toContain('330g plain flour');
    expect(r).toMatchObject({ usedAi: true, usable: true });
    expect(r.draft.sourceName).toBe('social.test');
  });

  it('still prefers the page body when there is one', async () => {
    const ai = fakeAi();
    await importFromUrl('https://x.test', { fetchPage: page('no-recipe.html'), fetchBytes: img().fetchBytes, ai, images: images() });
    const sent = ai.extractRecipe.mock.calls[0][0] as { text: string };
    expect(sent.text).toContain('Fry an onion, add stock and simmer for 20 minutes.');
  });
});
