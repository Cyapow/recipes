import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { createImageStore } from '../images/store.js';
import { buildApp } from '../app.js';
import { openDb } from '../db.js';
import { AiInvalidOutputError, AiRefusedError, AiRequestError, type AiClient } from './client.js';

const draft = {
  title: 'Spag bol', description: null, origin: 'other', brand: 'Gousto', dishPhoto: { image: 0, x0: 0, y0: 0, x1: 500, y1: 500 }, sourceName: 'x', sourceUrl: 'http://x',
  servings: null, prepMinutes: null, cookMinutes: null,
  ingredients: [{ group: null, quantity: null, unit: null, item: 'red wine', note: null }],
  steps: [], notes: null, tags: [], imageIds: [], gaps: ['quantity for red wine'],
};
const extraction = { draft, provider: 'openai' as const, model: 'gpt-x' };
const make = (ai?: AiClient, config: Record<string, unknown> = {}, web: Record<string, unknown> = {}) =>
  buildApp({ config: { dataDir: '/nonexistent', ...config } as never, db: openDb(':memory:'), ai, ...web });
const post = (app: ReturnType<typeof make>, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/ai/describe', payload: payload as never });

describe('POST /api/ai/describe', () => {
  it('returns the draft unchanged except origin/source forced', async () => {
    const extractRecipe = vi.fn().mockResolvedValue(extraction);
    const res = await post(make({ extractRecipe }), { text: ' red wine, mince ' });
    expect(res.statusCode).toBe(200);
    const { dishPhoto: _d, ...rest } = draft;
    expect(res.json()).toEqual({ ...rest, brand: 'Mine', origin: 'mine', sourceName: null, sourceUrl: null, provider: 'openai', model: 'gpt-x' });
    expect(res.json().ingredients[0].quantity).toBeNull();
    expect('dishPhoto' in res.json()).toBe(false);
    expect(extractRecipe).toHaveBeenCalledWith({ kind: 'description', text: 'red wine, mince' });
  });

  it('drops a brand gap, since the caller sets the brand', async () => {
    const withGap = { ...extraction, draft: { ...draft, gaps: ['Brand', 'servings'] } };
    const res = await post(make({ extractRecipe: vi.fn().mockResolvedValue(withGap) }), { text: 'x' });
    expect(res.json().gaps).toEqual(['servings']);
  });

  it('400 on empty, whitespace or missing text', async () => {
    const app = make({ extractRecipe: vi.fn() });
    expect((await post(app, { text: '' })).statusCode).toBe(400);
    expect((await post(app, { text: '   \n' })).statusCode).toBe(400);
    expect((await post(app, {})).statusCode).toBe(400);
  });

  it('413 on oversized text', async () => {
    const res = await post(make({ extractRecipe: vi.fn() }), { text: 'a'.repeat(20_001) });
    expect(res.statusCode).toBe(413);
  });

  it('503 when AI is not configured', async () => {
    const res = await post(make(undefined), { text: 'x' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'AI not configured' });
  });

  it('502 on invalid AI output', async () => {
    const res = await post(make({ extractRecipe: vi.fn().mockRejectedValue(new AiInvalidOutputError('bad')) }), { text: 'x' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'AI returned an invalid recipe', code: 'other' });
  });

  it('502 with a distinct message when the AI refuses', async () => {
    const res = await post(make({ extractRecipe: vi.fn().mockRejectedValue(new AiRefusedError()) }), { text: 'x' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'The AI declined this request', code: 'other' });
  });

  it('502 on request failure', async () => {
    const res = await post(make({ extractRecipe: vi.fn().mockRejectedValue(new AiRequestError()) }), { text: 'x' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'AI request failed', code: 'other' });
  });

  it.each([
    ['no_credit', 'The AI account is out of credit. Add credit or switch provider.'],
    ['auth', 'The AI key was rejected. Check the key in .env.'],
    ['rate_limit', 'The AI is busy right now. Try again in a minute.'],
    ['unavailable', "The AI didn't respond. Try again."],
    ['timeout', "The AI didn't respond. Try again."],
  ] as const)('502 {error, code} for provider failure %s', async (code, error) => {
    const res = await post(make({ extractRecipe: vi.fn().mockRejectedValue(new AiRequestError(code)) }), { text: 'x' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error, code });
  });

  it('any other thrown error is a generic 502 without its text', async () => {
    const res = await post(make({ extractRecipe: vi.fn().mockRejectedValue(new Error('sk-secret blew up')) }), { text: 'x' });
    expect(res.statusCode).toBe(502);
    expect(JSON.stringify(res.json())).not.toContain('secret');
  });
});

describe('GET /api/ai/status', () => {
  const config = { openaiApiKey: 'sk-live-SECRETVALUE', openaiModel: 'gpt-x', geminiApiKey: 'gem-SECRETVALUE', geminiModel: 'g-1', anthropicModel: 'claude-x', aiProvider: 'gemini' };
  it('lists providers and the active one, with no secrets', async () => {
    const res = await make(undefined, config).inject({ method: 'GET', url: '/api/ai/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      providers: [
        { name: 'anthropic', label: 'Claude', configured: false, model: 'claude-x' },
        { name: 'openai', label: 'ChatGPT', configured: true, model: 'gpt-x' },
        { name: 'gemini', label: 'Gemini', configured: true, model: 'g-1' },
      ],
      active: 'gemini',
    });
    expect(res.body).not.toMatch(/SECRETVALUE|sk-live|gem-/);
  });
  it('reports no active provider when nothing is configured', async () => {
    const res = await make(undefined, { anthropicModel: 'm', openaiModel: 'm', geminiModel: 'm' }).inject({ method: 'GET', url: '/api/ai/status' });
    expect(res.json().active).toBeNull();
  });
});

describe('POST /api/ai/describe with a link in the text', () => {
  const PHOTO = 'a'.repeat(64) + '.jpg';
  const web = (html: string) => ({
    fetchPage: vi.fn(async () => ({ html, finalUrl: 'https://www.facebook.com/reel/99/' })),
    fetchBytes: vi.fn(async () => ({ bytes: Buffer.from('img'), contentType: 'image/jpeg', finalUrl: 'x' })),
    images: { save: vi.fn(async () => PHOTO), path: vi.fn(), dir: '/x' },
  });
  const pasted = 'From URL\nhttps://www.facebook.com/share/r/1CXPhAtkLT/\n\n3lb chuck roast, seared';

  it('takes the photo and the source from the page the description links to', async () => {
    const w = web('<meta property="og:image" content="https://x.test/pot.jpg">');
    const res = await post(make({ extractRecipe: vi.fn().mockResolvedValue(extraction) }, {}, w), { text: pasted });
    expect(res.json()).toMatchObject({ imageIds: [PHOTO], sourceUrl: 'https://www.facebook.com/reel/99/', sourceName: 'facebook.com' });
    expect(w.fetchPage).toHaveBeenCalledWith('https://www.facebook.com/share/r/1CXPhAtkLT/');
  });

  it('reads the recipe from the text, never from the page', async () => {
    const extractRecipe = vi.fn().mockResolvedValue(extraction);
    const w = web('<meta property="og:image" content="https://x.test/pot.jpg">');
    await post(make({ extractRecipe }, {}, w), { text: pasted });
    expect(extractRecipe).toHaveBeenCalledWith({ kind: 'description', text: pasted });
  });

  it('still returns the recipe when the page will not load', async () => {
    const w = { ...web(''), fetchPage: vi.fn(async () => { throw new Error('blocked'); }) };
    const res = await post(make({ extractRecipe: vi.fn().mockResolvedValue(extraction) }, {}, w), { text: pasted });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ imageIds: [], sourceUrl: null, sourceName: null });
  });
});

describe('POST /api/ai/photos', () => {
  const setup = async (ai?: AiClient, n = 2) => {
    const images = createImageStore(mkdtempSync(path.join(tmpdir(), 'ai-photos-')));
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(await images.save(await sharp({ create: { width: 1000, height: 500, channels: 3, background: { r: 10 + i, g: 50, b: 90 } } }).png().toBuffer()));
    }
    const app = make(ai, {}, { images });
    return { app, ids, images };
  };
  const photos = (app: ReturnType<typeof make>, payload: unknown) =>
    app.inject({ method: 'POST', url: '/api/ai/photos', payload: payload as never });
  const photoDraft = (over: Record<string, unknown> = {}) => ({
    ...extraction,
    draft: { ...draft, brand: 'HelloFresh', gaps: ['servings'], dishPhoto: { image: 1, x0: 0, y0: 0, x1: 500, y1: 500 }, ...over },
  });

  it('crops the dish and puts the crop before the originals', async () => {
    const extractRecipe = vi.fn().mockResolvedValue(photoDraft());
    const { app, ids } = await setup({ extractRecipe });
    const res = await photos(app, { imageIds: ids });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.imageIds).toHaveLength(3);
    expect(body.imageIds[0]).not.toBe(ids[0]);
    expect(body.imageIds.slice(1)).toEqual(ids);
    expect(body.dishCrop).toEqual({ sourceImageId: ids[1], x0: 0, y0: 0, x1: 500, y1: 500 });
    expect('dishPhoto' in body).toBe(false);
    expect(body).toMatchObject({ origin: 'other', brand: 'HelloFresh', sourceName: 'HelloFresh', sourceUrl: null, provider: 'openai', model: 'gpt-x' });
    const call = extractRecipe.mock.calls[0]![0];
    expect(call.kind).toBe('photos');
    expect(call.images).toHaveLength(2);
    expect(call.images[0]).toMatchObject({ mediaType: 'image/jpeg' });
    expect(typeof call.images[0].base64).toBe('string');
  });

  it('makes no crop for an image index that does not exist', async () => {
    const { app, ids } = await setup({ extractRecipe: vi.fn().mockResolvedValue(photoDraft({ dishPhoto: { image: 5, x0: 0, y0: 0, x1: 500, y1: 500 } })) });
    const body = (await photos(app, { imageIds: ids })).json();
    expect(body.imageIds).toEqual(ids);
    expect(body.dishCrop).toBeNull();
  });

  it('makes no crop for a tiny box or no box, and still returns the photos', async () => {
    const tiny = await setup({ extractRecipe: vi.fn().mockResolvedValue(photoDraft({ dishPhoto: { image: 0, x0: 0, y0: 0, x1: 20, y1: 900 } })) });
    const a = await photos(tiny.app, { imageIds: tiny.ids });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ imageIds: tiny.ids, dishCrop: null });
    const none = await setup({ extractRecipe: vi.fn().mockResolvedValue(photoDraft({ dishPhoto: null })) });
    expect((await photos(none.app, { imageIds: none.ids })).json()).toMatchObject({ imageIds: none.ids, dishCrop: null });
  });

  it('crops an inverted, out-of-range box into the image', async () => {
    const { app, ids } = await setup({ extractRecipe: vi.fn().mockResolvedValue(photoDraft({ dishPhoto: { image: 0, x0: 600, y0: 1200, x1: 100, y1: -50 } })) });
    const body = (await photos(app, { imageIds: ids })).json();
    expect(body.imageIds).toHaveLength(3);
    expect(body.dishCrop).toEqual({ sourceImageId: ids[0], x0: 100, y0: 0, x1: 600, y1: 1000 });
  });

  it('400 unless 1-6 ids that all exist', async () => {
    const { app, ids } = await setup({ extractRecipe: vi.fn() }, 7);
    expect((await photos(app, { imageIds: ids })).statusCode).toBe(400);
    expect((await photos(app, { imageIds: [] })).statusCode).toBe(400);
    expect((await photos(app, {})).statusCode).toBe(400);
    expect((await photos(app, { imageIds: ['nope'] })).statusCode).toBe(400);
    expect((await photos(app, { imageIds: [ids[0], 'f'.repeat(64) + '.jpg'] })).statusCode).toBe(400);
  });

  it('adds a brand gap when the AI found no brand', async () => {
    const { app, ids } = await setup({ extractRecipe: vi.fn().mockResolvedValue(photoDraft({ brand: null, gaps: ['servings'] })) });
    const body = (await photos(app, { imageIds: ids })).json();
    expect(body.origin).toBe('other');
    expect(body.brand).toBeNull();
    expect(body.sourceName).toBeNull();
    expect(body.gaps).toEqual(['servings', 'brand']);
  });

  it('does not repeat a brand gap the AI already listed', async () => {
    const { app, ids } = await setup({ extractRecipe: vi.fn().mockResolvedValue(photoDraft({ brand: null, gaps: [' Brand '] })) });
    expect((await photos(app, { imageIds: ids })).json().gaps).toEqual([' Brand ']);
  });

  it('503 without AI', async () => {
    const { app, ids } = await setup(undefined);
    expect((await photos(app, { imageIds: ids })).statusCode).toBe(503);
  });

  it('502 {error, code} for provider failure and the same mapping as describe otherwise', async () => {
    const run = async (err: Error) => {
      const { app, ids } = await setup({ extractRecipe: vi.fn().mockRejectedValue(err) });
      return photos(app, { imageIds: ids });
    };
    const credit = await run(new AiRequestError('no_credit'));
    expect(credit.statusCode).toBe(502);
    expect(credit.json()).toEqual({ error: 'The AI account is out of credit. Add credit or switch provider.', code: 'no_credit' });
    expect((await run(new AiRefusedError())).json()).toEqual({ error: 'The AI declined this request', code: 'other' });
    expect((await run(new AiInvalidOutputError('x'))).json()).toEqual({ error: 'AI returned an invalid recipe', code: 'other' });
    expect((await run(new Error('sk-secret'))).json()).toEqual({ error: 'AI request failed', code: 'other' });
  });
});
