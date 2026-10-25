import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { openDb } from '../db.js';
import { AiInvalidOutputError, AiRequestError, type AiClient } from './client.js';

const draft = {
  title: 'Spag bol', description: null, origin: 'other', sourceName: 'x', sourceUrl: 'http://x',
  servings: null, prepMinutes: null, cookMinutes: null,
  ingredients: [{ group: null, quantity: null, unit: null, item: 'red wine', note: null }],
  steps: [], notes: null, tags: [], imageIds: [], gaps: ['quantity for red wine'],
};
const make = (ai?: AiClient) => buildApp({ config: { dataDir: '/nonexistent' } as never, db: openDb(':memory:'), ai });
const post = (app: ReturnType<typeof make>, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/ai/describe', payload: payload as never });

describe('POST /api/ai/describe', () => {
  it('returns the draft unchanged except origin/source forced', async () => {
    const extractRecipe = vi.fn().mockResolvedValue(draft);
    const res = await post(make({ extractRecipe }), { text: ' red wine, mince ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...draft, origin: 'mine', sourceName: null, sourceUrl: null });
    expect(res.json().ingredients[0].quantity).toBeNull();
    expect(extractRecipe).toHaveBeenCalledWith({ kind: 'description', text: 'red wine, mince' });
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
    expect(res.json()).toEqual({ error: 'AI returned an invalid recipe' });
  });

  it('502 on request failure', async () => {
    const res = await post(make({ extractRecipe: vi.fn().mockRejectedValue(new AiRequestError()) }), { text: 'x' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'AI request failed' });
  });
});
