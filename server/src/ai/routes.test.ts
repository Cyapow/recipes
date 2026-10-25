import { describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { openDb } from '../db.js';
import { AiInvalidOutputError, AiRefusedError, AiRequestError, type AiClient } from './client.js';

const draft = {
  title: 'Spag bol', description: null, origin: 'other', sourceName: 'x', sourceUrl: 'http://x',
  servings: null, prepMinutes: null, cookMinutes: null,
  ingredients: [{ group: null, quantity: null, unit: null, item: 'red wine', note: null }],
  steps: [], notes: null, tags: [], imageIds: [], gaps: ['quantity for red wine'],
};
const extraction = { draft, provider: 'openai' as const, model: 'gpt-x' };
const make = (ai?: AiClient, config: Record<string, unknown> = {}) =>
  buildApp({ config: { dataDir: '/nonexistent', ...config } as never, db: openDb(':memory:'), ai });
const post = (app: ReturnType<typeof make>, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/ai/describe', payload: payload as never });

describe('POST /api/ai/describe', () => {
  it('returns the draft unchanged except origin/source forced', async () => {
    const extractRecipe = vi.fn().mockResolvedValue(extraction);
    const res = await post(make({ extractRecipe }), { text: ' red wine, mince ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ...draft, origin: 'mine', sourceName: null, sourceUrl: null, provider: 'openai', model: 'gpt-x' });
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
