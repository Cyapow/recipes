import { describe, expect, it, vi } from 'vitest';
import { AiInvalidOutputError, AiRefusedError, AiRequestError, createAiClient } from './client.js';
import { ProviderError, type Provider, type ProviderErrorCode, type ProviderName, type ProviderResult } from './providers/types.js';
import { aiStatus, providerOrder } from './registry.js';
import { loadConfig } from '../config.js';
import type { ProviderRequest } from './providers/types.js';

const draft = {
  title: 'Spag bol', description: null, origin: 'mine', sourceName: null, sourceUrl: null,
  servings: null, prepMinutes: null, cookMinutes: null,
  ingredients: [{ group: null, quantity: null, unit: null, item: 'red wine', note: null }],
  steps: [{ text: 'Brown the mince', imageId: null, ingredients: [] }], notes: null, tags: [], imageIds: [], gaps: ['quantity for red wine'],
};
const ok: ProviderResult = { kind: 'draft', input: draft, raw: 'x' };
type Step = ProviderResult | ProviderErrorCode;

function fake(name: ProviderName, ...steps: Step[]): Provider & { complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(async () => {
    const s = steps.shift() ?? ok;
    if (typeof s === 'string') throw new ProviderError(s);
    return s;
  });
  return { name, label: name, model: `${name}-model`, complete } as never;
}
const keys = { anthropicApiKey: 'a', openaiApiKey: 'o', geminiApiKey: 'g' };
const cfg = (extra: Record<string, unknown> = {}) => ({ ...keys, ...extra }) as never;
const input = { kind: 'description' as const, text: 't' };
const build = (config: unknown, fakes: Partial<Record<ProviderName, Provider>>) =>
  createAiClient(config as never, { providers: fakes });

describe('providerOrder', () => {
  it('defaults to Claude, ChatGPT, Gemini and only includes providers with keys', () => {
    expect(providerOrder(cfg())).toEqual(['anthropic', 'openai', 'gemini']);
    expect(providerOrder({ openaiApiKey: 'o', geminiApiKey: 'g' } as never)).toEqual(['openai', 'gemini']);
    expect(providerOrder({ geminiApiKey: 'g' } as never)).toEqual(['gemini']);
    expect(providerOrder({} as never)).toEqual([]);
  });
  it('puts a forced provider first, then the rest in default order', () => {
    expect(providerOrder(cfg({ aiProvider: 'gemini' }))).toEqual(['gemini', 'anthropic', 'openai']);
    expect(providerOrder(cfg({ aiProvider: 'openai' }))).toEqual(['openai', 'anthropic', 'gemini']);
  });
  it('ignores a forced provider that has no key', () => {
    expect(providerOrder({ ...cfg({ aiProvider: 'gemini' }), geminiApiKey: undefined } as never)).toEqual(['anthropic', 'openai']);
  });
});

describe('loadConfig AI settings', () => {
  it('trims keys, models and settings; whitespace-only counts as unset', () => {
    const c = loadConfig({ ANTHROPIC_API_KEY: '  a \n', OPENAI_API_KEY: '   ', OPENAI_MODEL: ' m2 ', GEMINI_API_KEY: ' g ', GEMINI_MODEL: '  ', AI_PROVIDER: ' OpenAI ', ANTHROPIC_MODEL: ' ' });
    expect(c.anthropicApiKey).toBe('a');
    expect(c.openaiApiKey).toBeUndefined();
    expect(c.openaiModel).toBe('m2');
    expect(c.geminiApiKey).toBe('g');
    expect(c.geminiModel).toBe('gemini-3.5-flash-lite');
    expect(c.anthropicModel).toBe('claude-sonnet-5-5');
    expect(c.aiProvider).toBe('openai');
  });
  it('OPENAI_REASONING_EFFORT: low by default, overridable, empty/default omits, junk falls back to low', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadConfig({}).openaiReasoningEffort).toBe('low');
    expect(loadConfig({ OPENAI_REASONING_EFFORT: ' High ' }).openaiReasoningEffort).toBe('high');
    for (const v of ['', '  ', 'default', 'DEFAULT']) expect(loadConfig({ OPENAI_REASONING_EFFORT: v }).openaiReasoningEffort).toBeUndefined();
    for (const v of ['none', 'minimal', 'xhigh', 'max']) expect(loadConfig({ OPENAI_REASONING_EFFORT: v }).openaiReasoningEffort).toBe(v);
    expect(loadConfig({ OPENAI_REASONING_EFFORT: 'turbo' }).openaiReasoningEffort).toBe('low');
    warn.mockRestore();
  });
  it('GEMINI_THINKING_LEVEL: low by default, overridable, empty/default omits, junk falls back to low', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadConfig({}).geminiThinkingLevel).toBe('low');
    expect(loadConfig({ GEMINI_THINKING_LEVEL: 'Minimal' }).geminiThinkingLevel).toBe('minimal');
    for (const v of ['', 'default']) expect(loadConfig({ GEMINI_THINKING_LEVEL: v }).geminiThinkingLevel).toBeUndefined();
    expect(loadConfig({ GEMINI_THINKING_LEVEL: 'extreme' }).geminiThinkingLevel).toBe('low');
    warn.mockRestore();
  });
  it('AI_TOTAL_TIMEOUT_MS: 100 s default, floor of 10 s, junk ignored', () => {
    expect(loadConfig({}).aiTotalTimeoutMs).toBe(100_000);
    expect(loadConfig({ AI_TOTAL_TIMEOUT_MS: '30000' }).aiTotalTimeoutMs).toBe(30_000);
    expect(loadConfig({ AI_TOTAL_TIMEOUT_MS: '500' }).aiTotalTimeoutMs).toBe(10_000);
    expect(loadConfig({ AI_TOTAL_TIMEOUT_MS: 'abc' }).aiTotalTimeoutMs).toBe(100_000);
  });
  it('reads keys and models, with defaults', () => {
    const c = loadConfig({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' });
    expect([c.anthropicApiKey, c.openaiApiKey, c.geminiApiKey]).toEqual(['a', 'o', 'g']);
    expect(c.anthropicModel).toBe('claude-sonnet-5-5');
    expect(c.openaiModel).toMatch(/\S/);
    expect(c.geminiModel).toMatch(/\S/);
    expect(c.aiProvider).toBeUndefined();
  });
  it('treats empty strings as unset and honours overrides', () => {
    const c = loadConfig({ OPENAI_API_KEY: '', OPENAI_MODEL: 'm1', GEMINI_MODEL: '', AI_PROVIDER: 'openai' });
    expect(c.openaiApiKey).toBeUndefined();
    expect(c.openaiModel).toBe('m1');
    expect(c.geminiModel).toMatch(/\S/);
    expect(c.aiProvider).toBe('openai');
  });
  it('ignores an unknown AI_PROVIDER with a warning, no crash', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = loadConfig({ AI_PROVIDER: 'llama', OPENAI_API_KEY: 'sk-secret-zzz' });
    expect(c.aiProvider).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/AI_PROVIDER/);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sk-secret-zzz');
    warn.mockRestore();
  });
  it('accepts AI_PROVIDER case-insensitively and empty as unset', () => {
    expect(loadConfig({ AI_PROVIDER: 'Gemini' }).aiProvider).toBe('gemini');
    expect(loadConfig({ AI_PROVIDER: '' }).aiProvider).toBeUndefined();
  });
});

describe('aiStatus', () => {
  it('lists providers, labels, models and the active one, with no secrets', () => {
    const config = loadConfig({ OPENAI_API_KEY: 'sk-secret-openai', GEMINI_API_KEY: 'secret-gem', GEMINI_MODEL: 'g-1' });
    const s = aiStatus(config);
    expect(s.providers.map((p) => [p.name, p.label, p.configured])).toEqual([
      ['anthropic', 'Claude', false],
      ['openai', 'ChatGPT', true],
      ['gemini', 'Gemini', true],
    ]);
    expect(s.providers[2]!.model).toBe('g-1');
    expect(s.active).toBe('openai');
    expect(JSON.stringify(s)).not.toMatch(/secret/);
  });
  it('has no active provider when nothing is configured', () => {
    expect(aiStatus(loadConfig({})).active).toBeNull();
  });
});

describe('fallback orchestration', () => {
  it('uses only the first provider when it works, and reports who answered', async () => {
    const a = fake('anthropic'), o = fake('openai');
    const out = await build(cfg(), { anthropic: a, openai: o }).extractRecipe(input);
    expect(out).toMatchObject({ draft, provider: 'anthropic', model: 'anthropic-model' });
    expect(o.complete).not.toHaveBeenCalled();
  });

  it.each(['auth', 'no_credit', 'rate_limit', 'unavailable', 'timeout'] as const)('falls back on %s', async (code) => {
    const a = fake('anthropic', code), o = fake('openai');
    const out = await build(cfg(), { anthropic: a, openai: o, gemini: fake('gemini') }).extractRecipe(input);
    expect(out).toMatchObject({ provider: 'openai', model: 'openai-model' });
    expect(a.complete).toHaveBeenCalledTimes(1);
  });

  it('follows the forced order, then the default order', async () => {
    const a = fake('anthropic'), o = fake('openai', 'auth'), g = fake('gemini', 'auth');
    const out = await build(cfg({ aiProvider: 'gemini' }), { anthropic: a, openai: o, gemini: g }).extractRecipe(input);
    expect(out.provider).toBe('anthropic');
    expect(g.complete.mock.invocationCallOrder[0]).toBeLessThan(a.complete.mock.invocationCallOrder[0]!);
    expect(o.complete).not.toHaveBeenCalled();
  });

  it('only tries providers that have a key', async () => {
    const o = fake('openai', 'rate_limit'), g = fake('gemini');
    const a = fake('anthropic');
    const out = await build({ openaiApiKey: 'o', geminiApiKey: 'g' }, { anthropic: a, openai: o, gemini: g }).extractRecipe(input);
    expect(out.provider).toBe('gemini');
    expect(a.complete).not.toHaveBeenCalled();
  });

  it('does NOT fall back on a refusal', async () => {
    const a = fake('anthropic', { kind: 'refusal' }), o = fake('openai');
    await expect(build(cfg(), { anthropic: a, openai: o }).extractRecipe(input)).rejects.toBeInstanceOf(AiRefusedError);
    expect(o.complete).not.toHaveBeenCalled();
  });

  it('does NOT fall back on invalid output after the retry', async () => {
    const bad: ProviderResult = { kind: 'draft', input: {}, raw: 'x' };
    const a = fake('anthropic', bad, bad), o = fake('openai');
    await expect(build(cfg(), { anthropic: a, openai: o }).extractRecipe(input)).rejects.toBeInstanceOf(AiInvalidOutputError);
    expect(a.complete).toHaveBeenCalledTimes(2);
    expect(o.complete).not.toHaveBeenCalled();
  });

  it('does NOT fall back on an "other" error, and surfaces it', async () => {
    const a = fake('anthropic', 'other'), o = fake('openai');
    const err = await build(cfg(), { anthropic: a, openai: o }).extractRecipe(input).catch((e) => e);
    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.code).toBe('other');
    expect(o.complete).not.toHaveBeenCalled();
  });

  it('reports the FIRST provider code when every provider fails', async () => {
    const a = fake('anthropic', 'no_credit'), o = fake('openai', 'auth'), g = fake('gemini', 'timeout');
    const err = await build(cfg(), { anthropic: a, openai: o, gemini: g }).extractRecipe(input).catch((e) => e);
    expect(err).toBeInstanceOf(AiRequestError);
    expect(err.code).toBe('no_credit');
    expect(err.message).toBe('The AI account is out of credit. Add credit or switch provider.');
  });

  it('uses the plain-language message for each code', async () => {
    const msg: Record<string, string> = {
      auth: 'The AI key was rejected. Check the key in .env.',
      rate_limit: 'The AI is busy right now. Try again in a minute.',
      unavailable: "The AI didn't respond. Try again.",
      timeout: "The AI didn't respond. Try again.",
    };
    for (const [code, text] of Object.entries(msg)) {
      const err = await build({ openaiApiKey: 'o' }, { openai: fake('openai', code as ProviderErrorCode) }).extractRecipe(input).catch((e) => e);
      expect(err.message).toBe(text);
    }
    expect(new AiRequestError('other').message).toBe('AI request failed');
  });

  it('fails over on an error during the retry call too', async () => {
    const bad: ProviderResult = { kind: 'draft', input: {}, raw: 'x' };
    const a = fake('anthropic', bad, 'unavailable'), o = fake('openai');
    expect((await build(cfg(), { anthropic: a, openai: o }).extractRecipe(input)).provider).toBe('openai');
  });

  it('a provider that throws something unexpected counts as unavailable', async () => {
    const a = fake('anthropic');
    a.complete.mockRejectedValueOnce(new Error('boom sk-secret'));
    const o = fake('openai');
    expect((await build(cfg(), { anthropic: a, openai: o }).extractRecipe(input)).provider).toBe('openai');
  });
});

describe('model_unavailable', () => {
  it('falls back to the next provider and has its own message', async () => {
    const a = fake('anthropic', 'model_unavailable'), o = fake('openai');
    expect((await build(cfg(), { anthropic: a, openai: o }).extractRecipe(input)).provider).toBe('openai');
    const err = await build({ openaiApiKey: 'o' }, { openai: fake('openai', 'model_unavailable') }).extractRecipe(input).catch((e) => e);
    expect(err.code).toBe('model_unavailable');
    expect(err.message).toBe("The AI model name isn't available. Check the model setting in .env.");
  });
  it('reports the first provider code when all fail', async () => {
    const err = await build(cfg(), { anthropic: fake('anthropic', 'model_unavailable'), openai: fake('openai', 'auth'), gemini: fake('gemini', 'timeout') }).extractRecipe(input).catch((e) => e);
    expect(err.code).toBe('model_unavailable');
  });
});

describe('a later provider\'s non-fallback error is what the user sees', () => {
  it('shows the refusal even though the first provider failed with a provider error', async () => {
    const a = fake('anthropic', 'no_credit'), o = fake('openai', { kind: 'refusal' });
    await expect(build(cfg(), { anthropic: a, openai: o }).extractRecipe(input)).rejects.toBeInstanceOf(AiRefusedError);
  });
});

describe('overall deadline', () => {
  /** Waits `ms` (fake clock), then fails with `code`; or never answers if code is null (until aborted). */
  function slow(name: ProviderName, ms: number, code: ProviderErrorCode | null = null) {
    const complete = vi.fn((req: ProviderRequest) =>
      new Promise<ProviderResult>((_, reject) => {
        const t = code === null ? undefined : setTimeout(() => reject(new ProviderError(code)), ms);
        req.signal.addEventListener('abort', () => { clearTimeout(t); reject(new ProviderError('timeout')); });
      }),
    );
    return { name, label: name, model: `${name}-model`, complete } as Provider & { complete: typeof complete };
  }
  const run = (config: unknown, fakes: Partial<Record<ProviderName, Provider>>, deps = {}) => {
    const p = createAiClient(config as never, { providers: fakes, ...deps }).extractRecipe(input).catch((e) => e);
    return p;
  };
  const withTimers = async (fn: () => Promise<void>) => {
    vi.useFakeTimers();
    try { await fn(); } finally { vi.useRealTimers(); }
  };

  it('three stalled providers stop at the overall deadline with code timeout, the last one capped by the time left', async () => {
    await withTimers(async () => {
      const a = slow('anthropic', 0), o = slow('openai', 0), g = slow('gemini', 0);
      const p = run(cfg(), { anthropic: a, openai: o, gemini: g }, { totalTimeoutMs: 100_000, attemptTimeoutMs: 60_000 });
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(40_000);
      const err = await p;
      expect(err).toBeInstanceOf(AiRequestError);
      expect(err.code).toBe('timeout');
      expect(err.message).toBe("The AI didn't respond. Try again.");
      expect(o.complete.mock.calls[0]![0].timeoutMs).toBeLessThanOrEqual(40_000);
      expect(g.complete).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('starts no new provider when the time left is below the minimum useful attempt', async () => {
    await withTimers(async () => {
      const a = slow('anthropic', 90_000, 'unavailable'), o = slow('openai', 0);
      const p = run(cfg(), { anthropic: a, openai: o }, { totalTimeoutMs: 100_000, attemptTimeoutMs: 95_000 });
      await vi.advanceTimersByTimeAsync(90_000);
      const err = await p;
      expect(err.code).toBe('unavailable');
      expect(o.complete).not.toHaveBeenCalled();
    });
  });

  it('does start another provider when enough time is left', async () => {
    await withTimers(async () => {
      const a = slow('anthropic', 50_000, 'unavailable');
      const o = fake('openai');
      const p = createAiClient(cfg() as never, { providers: { anthropic: a, openai: o }, totalTimeoutMs: 100_000 }).extractRecipe(input);
      await vi.advanceTimersByTimeAsync(50_000);
      expect((await p).provider).toBe('openai');
    });
  });

  it('starts no invalid-output retry when time is short; reports timeout', async () => {
    await withTimers(async () => {
      const bad: ProviderResult = { kind: 'draft', input: {}, raw: 'x' };
      const a = fake('anthropic', bad);
      a.complete.mockImplementationOnce(() => new Promise((r) => setTimeout(() => r(bad), 90_000)));
      const p = run({ anthropicApiKey: 'a' }, { anthropic: a }, { totalTimeoutMs: 100_000 });
      await vi.advanceTimersByTimeAsync(90_000);
      const err = await p;
      expect(err).toBeInstanceOf(AiRequestError);
      expect(err.code).toBe('timeout');
      expect(a.complete).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the first provider's code when the deadline then cuts a later provider off", async () => {
    await withTimers(async () => {
      const a = slow('anthropic', 0, 'no_credit'), o = slow('openai', 0);
      const p = run(cfg(), { anthropic: a, openai: o, gemini: slow('gemini', 0) }, { totalTimeoutMs: 100_000, attemptTimeoutMs: 100_000 });
      await vi.advanceTimersByTimeAsync(100_000);
      expect((await p).code).toBe('no_credit');
    });
  });

  it('always makes the first attempt, even with a tiny total', async () => {
    const a = fake('anthropic');
    expect((await build(cfg(), { anthropic: a }).extractRecipe(input)).provider).toBe('anthropic');
    const b = fake('anthropic');
    expect((await createAiClient(cfg() as never, { providers: { anthropic: b }, totalTimeoutMs: 10_000 }).extractRecipe(input)).provider).toBe('anthropic');
  });
});
