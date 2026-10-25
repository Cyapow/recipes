import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config.js';
import type { RecipeDraft } from '../recipes/schema.js';
import { AiDraftParseSchema, buildUserMessage, recipeToolSchema, SYSTEM_PROMPT, TOOL_NAME, toRecipeDraft } from './draft.js';

export interface AiClient {
  extractRecipe(input: { kind: 'description' | 'page'; text: string; sourceUrl?: string }): Promise<RecipeDraft>;
}

export class AiInvalidOutputError extends Error {
  constructor(message = 'AI returned an invalid recipe') {
    super(message);
    this.name = 'AiInvalidOutputError';
  }
}

export class AiRequestError extends Error {
  constructor(message = 'AI request failed') {
    super(message);
    this.name = 'AiRequestError';
  }
}

export class AiRefusedError extends Error {
  constructor(message = 'The AI declined this request') {
    super(message);
    this.name = 'AiRefusedError';
  }
}

/** The slice of the Anthropic SDK we use; lets tests inject a fake. */
export type SdkLike = { messages: { stream(params: Anthropic.MessageCreateParamsNonStreaming, opts?: { timeout?: number; signal?: AbortSignal }): { finalMessage(): Promise<Anthropic.Message> } } };

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_TOKENS = 16_000;

type Msg = Anthropic.MessageParam;

/**
 * Each attempt is bounded by an AbortController (the SDK's own timeout only covers waiting for response headers).
 * A timeout or abort throws AiRequestError straight away: it is not retried and does not use the invalid-output
 * retry, so the worst case is two attempts (invalid output, then a second call) of attemptTimeoutMs each.
 */
export function createAnthropicClient(config: Config, sdk?: SdkLike, opts: { attemptTimeoutMs?: number } = {}): AiClient {
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const client: SdkLike = sdk ?? (new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 1 }) as unknown as SdkLike);
  const tools = [
    { name: TOOL_NAME, description: 'Record the recipe exactly as the user stated it.', strict: true, input_schema: recipeToolSchema() },
  ];

  async function call(messages: Msg[], maxTokens: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), attemptTimeoutMs);
    try {
      // Forced tool_choice 400s on current models, so the system prompt demands the tool call instead.
      const stream = client.messages
        .stream(
          {
            model: config.anthropicModel,
            max_tokens: maxTokens,
            system: SYSTEM_PROMPT,
            tools: tools as Anthropic.Tool[],
            tool_choice: { type: 'auto' },
            output_config: { effort: 'low' },
            messages,
          },
          { timeout: attemptTimeoutMs, signal: controller.signal },
        );
      const aborted = new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }),
      );
      return await Promise.race([stream.finalMessage(), aborted]);
    } catch {
      throw new AiRequestError(); // deliberately drops the upstream error: it may echo request details
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async extractRecipe(input) {
      const messages: Msg[] = [{ role: 'user', content: buildUserMessage(input) }];
      let lastError = '';
      let maxTokens = MAX_TOKENS;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await call(messages, maxTokens);
        if (res.stop_reason === 'refusal') throw new AiRefusedError();
        if (res.stop_reason === 'max_tokens') {
          // Truncated tool input can still validate (gaps is last), so never accept it.
          lastError = 'response truncated (max_tokens)';
          maxTokens *= 2;
          continue;
        }
        const block = res.content.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
        if (block && block.type === 'tool_use') {
          const parsed = AiDraftParseSchema.safeParse(block.input);
          if (parsed.success) return toRecipeDraft(parsed.data);
          lastError = parsed.error.message;
          messages.push(
            { role: 'assistant', content: res.content },
            {
              role: 'user',
              // One tool_result per tool_use id, or the API rejects the next request.
              content: res.content
                .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
                .map((b) => ({
                  type: 'tool_result' as const,
                  tool_use_id: b.id,
                  is_error: true,
                  content: `Invalid recipe: ${lastError}\nCall ${TOOL_NAME} again with valid input. Still do not add anything the user did not say.`,
                })),
            },
          );
        } else {
          lastError = 'no tool call returned';
          messages.push(
            { role: 'assistant', content: res.content },
            { role: 'user', content: `Respond only by calling ${TOOL_NAME} with the recipe. Do not reply with text, and do not add anything the user did not say.` },
          );
        }
      }
      throw new AiInvalidOutputError(lastError);
    },
  };
}
