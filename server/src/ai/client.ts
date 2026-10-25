import type { Config } from '../config.js';
import type { RecipeDraft } from '../recipes/schema.js';
import { AiDraftParseSchema, buildUserMessage, SYSTEM_PROMPT, toRecipeDraft } from './draft.js';
import { createAnthropicProvider, type SdkLike } from './providers/anthropic.js';
import { createGeminiProvider } from './providers/gemini.js';
import { createOpenAiProvider } from './providers/openai.js';
import { aiErrorMessage, ProviderError, type Provider, type ProviderErrorCode, type ProviderMessage, type ProviderName, type ProviderResult } from './providers/types.js';
import { providerOrder } from './registry.js';

export type { SdkLike };
export type { ProviderErrorCode, ProviderName };

export type AiExtraction = { draft: RecipeDraft; provider: ProviderName; model: string };

export interface AiClient {
  extractRecipe(input: { kind: 'description' | 'page'; text: string; sourceUrl?: string }): Promise<AiExtraction>;
}

export class AiInvalidOutputError extends Error {
  constructor(message = 'AI returned an invalid recipe') {
    super(message);
    this.name = 'AiInvalidOutputError';
  }
}

/** A provider failure. `code` is safe to show; the message is the plain-language text for it. */
export class AiRequestError extends Error {
  constructor(readonly code: ProviderErrorCode = 'other') {
    super(aiErrorMessage(code));
    this.name = 'AiRequestError';
  }
}

export class AiRefusedError extends Error {
  constructor(message = 'The AI declined this request') {
    super(message);
    this.name = 'AiRefusedError';
  }
}

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 16_000;
const TOTAL_TIMEOUT_MS = 100_000;
/** Below this much remaining time no further attempt (retry or next provider) is started. */
const MIN_ATTEMPT_MS = 15_000;

export type AiClientDeps = {
  /** Replaces the Anthropic SDK (tests). */
  sdk?: SdkLike;
  /** Replaces fetch for the OpenAI and Gemini providers (tests). */
  fetchImpl?: typeof fetch;
  /** Replaces whole providers by name (tests). Which ones are tried, and in what order, still comes from the config. */
  providers?: Partial<Record<ProviderName, Provider>>;
  attemptTimeoutMs?: number;
  /** Overall deadline for one extractRecipe call; defaults to config.aiTotalTimeoutMs, then 100 s. */
  totalTimeoutMs?: number;
  /** Smallest remaining time worth starting another attempt in (default 15 s). */
  minAttemptMs?: number;
};

type Budget = { deadline: number; started: number };

/**
 * Each attempt is bounded by an AbortController (the SDK's own timeout only covers waiting for response headers).
 * A timeout throws AiRequestError('timeout') for that provider: it is not retried against the same provider, and does
 * not use the invalid-output retry. Provider failures (auth, credit, rate limit, unavailable, timeout) move on to the
 * next provider with a key; refusals, invalid output and our own bad requests ('other') do not.
 *
 * One overall deadline covers the whole call (all providers and retries) so an edge proxy or the browser does not
 * give up first. Each attempt's timer is min(per-attempt timeout, time left). The first attempt always starts; after
 * that, an attempt (retry or next provider) only starts if at least minAttemptMs remain.
 */
export function createAiClient(config: Config, deps: AiClientDeps = {}): AiClient {
  const attemptTimeoutMs = deps.attemptTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const make = (name: ProviderName): Provider =>
    deps.providers?.[name] ??
    (name === 'anthropic'
      ? createAnthropicProvider(config, deps.sdk)
      : name === 'openai'
        ? createOpenAiProvider(config, deps.fetchImpl)
        : createGeminiProvider(config, deps.fetchImpl));
  const providers = providerOrder(config).map(make);
  const totalTimeoutMs = deps.totalTimeoutMs ?? config.aiTotalTimeoutMs ?? TOTAL_TIMEOUT_MS;
  const minAttemptMs = deps.minAttemptMs ?? MIN_ATTEMPT_MS;
  const timeLeft = (b: Budget) => b.deadline - Date.now();

  async function attempt(budget: Budget, provider: Provider, messages: ProviderMessage[], maxTokens: number): Promise<ProviderResult> {
    const left = timeLeft(budget);
    if (budget.started > 0 && left < minAttemptMs) throw new AiRequestError('timeout');
    budget.started++;
    const timeoutMs = Math.max(1, Math.min(attemptTimeoutMs, left));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await provider.complete({ system: SYSTEM_PROMPT, messages, maxTokens, signal: controller.signal, timeoutMs });
    } catch (err) {
      // deliberately drops the upstream error: it may echo request details
      throw new AiRequestError(err instanceof ProviderError ? err.code : controller.signal.aborted ? 'timeout' : 'unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  async function extractWith(budget: Budget, provider: Provider, input: Parameters<AiClient['extractRecipe']>[0]): Promise<AiExtraction> {
    const messages: ProviderMessage[] = [{ role: 'user', text: buildUserMessage(input) }];
    let lastError = '';
    let maxTokens = MAX_TOKENS;
    for (let n = 0; n < 2; n++) {
      const res = await attempt(budget, provider, messages, maxTokens);
      if (res.kind === 'refusal') throw new AiRefusedError();
      if (res.kind === 'truncated') {
        lastError = 'response truncated (max_tokens)';
        maxTokens *= 2;
        continue;
      }
      if (res.kind === 'draft') {
        const parsed = AiDraftParseSchema.safeParse(res.input);
        if (parsed.success) return { draft: toRecipeDraft(parsed.data), provider: provider.name, model: provider.model };
        lastError = parsed.error.message;
        messages.push({ role: 'retry', raw: res.raw, problem: lastError });
      } else {
        lastError = 'no tool call returned';
        messages.push({ role: 'retry', raw: res.raw, problem: null });
      }
    }
    throw new AiInvalidOutputError(lastError);
  }

  return {
    async extractRecipe(input) {
      const budget: Budget = { deadline: Date.now() + totalTimeoutMs, started: 0 };
      // If every provider fails, the error reported is the FIRST provider's code, whatever the later ones said (so a
      // later deadline cut-off never hides "out of credit" from the provider the user prefers). A later provider that
      // fails with a non-fallback error (refusal, invalid output, 'other') is thrown as is and is what the user sees.
      let first: ProviderErrorCode | undefined;
      for (const provider of providers) {
        if (budget.started > 0 && timeLeft(budget) < minAttemptMs) break;
        try {
          return await extractWith(budget, provider, input);
        } catch (err) {
          if (err instanceof AiRequestError && err.code !== 'other') {
            first ??= err.code;
            continue;
          }
          throw err;
        }
      }
      throw new AiRequestError(first ?? 'other');
    },
  };
}

/**
 * Anthropic-only client with the original shape (resolves to the bare draft). Kept for the original
 * Anthropic test-suite and for single-provider use.
 */
export function createAnthropicClient(config: Config, sdk?: SdkLike, opts: { attemptTimeoutMs?: number } = {}) {
  const only = { ...config, aiProvider: 'anthropic' as const, openaiApiKey: undefined, geminiApiKey: undefined };
  const client = createAiClient(only, { sdk, attemptTimeoutMs: opts.attemptTimeoutMs });
  return { extractRecipe: async (input: Parameters<AiClient['extractRecipe']>[0]) => (await client.extractRecipe(input)).draft };
}
