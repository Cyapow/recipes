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

export type AiClientDeps = {
  /** Replaces the Anthropic SDK (tests). */
  sdk?: SdkLike;
  /** Replaces fetch for the OpenAI and Gemini providers (tests). */
  fetchImpl?: typeof fetch;
  /** Replaces whole providers by name (tests). Which ones are tried, and in what order, still comes from the config. */
  providers?: Partial<Record<ProviderName, Provider>>;
  attemptTimeoutMs?: number;
};

/**
 * Each attempt is bounded by an AbortController (the SDK's own timeout only covers waiting for response headers).
 * A timeout throws AiRequestError('timeout') for that provider: it is not retried against the same provider, and does
 * not use the invalid-output retry. Provider failures (auth, credit, rate limit, unavailable, timeout) move on to the
 * next provider with a key; refusals, invalid output and our own bad requests ('other') do not.
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

  async function attempt(provider: Provider, messages: ProviderMessage[], maxTokens: number): Promise<ProviderResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
    try {
      return await provider.complete({ system: SYSTEM_PROMPT, messages, maxTokens, signal: controller.signal, timeoutMs: attemptTimeoutMs });
    } catch (err) {
      // deliberately drops the upstream error: it may echo request details
      throw new AiRequestError(err instanceof ProviderError ? err.code : controller.signal.aborted ? 'timeout' : 'unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  async function extractWith(provider: Provider, input: Parameters<AiClient['extractRecipe']>[0]): Promise<AiExtraction> {
    const messages: ProviderMessage[] = [{ role: 'user', text: buildUserMessage(input) }];
    let lastError = '';
    let maxTokens = MAX_TOKENS;
    for (let n = 0; n < 2; n++) {
      const res = await attempt(provider, messages, maxTokens);
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
      let first: ProviderErrorCode | undefined;
      for (const provider of providers) {
        try {
          return await extractWith(provider, input);
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
