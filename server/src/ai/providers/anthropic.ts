import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../../config.js';
import { recipeToolSchema, TOOL_NAME } from '../draft.js';
import { classifyHttpError, ProviderError, raceAbort, type Provider, type ProviderMessage, type ProviderResult } from './types.js';

/** The slice of the Anthropic SDK we use; lets tests inject a fake. */
export type SdkLike = { messages: { stream(params: Anthropic.MessageCreateParamsNonStreaming, opts?: { timeout?: number; signal?: AbortSignal }): { finalMessage(): Promise<Anthropic.Message> } } };

type Msg = Anthropic.MessageParam;

function toMessages(messages: ProviderMessage[]): Msg[] {
  const out: Msg[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text });
      continue;
    }
    const content = m.raw as Anthropic.ContentBlock[];
    out.push({ role: 'assistant', content });
    if (m.problem !== null) {
      out.push({
        role: 'user',
        // One tool_result per tool_use id, or the API rejects the next request.
        content: content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
          .map((b) => ({
            type: 'tool_result' as const,
            tool_use_id: b.id,
            is_error: true,
            content: `Invalid recipe: ${m.problem}\nCall ${TOOL_NAME} again with valid input. Still do not add anything the user did not say.`,
          })),
      });
    } else {
      out.push({ role: 'user', content: `Respond only by calling ${TOOL_NAME} with the recipe. Do not reply with text, and do not add anything the user did not say.` });
    }
  }
  return out;
}

function toProviderError(err: unknown, signal: AbortSignal): ProviderError {
  if (err instanceof ProviderError) return err;
  if (signal.aborted) return new ProviderError('timeout');
  const e = err as { status?: unknown; name?: unknown; message?: unknown } | null;
  if (typeof e?.status === 'number') return new ProviderError(classifyHttpError(e.status, typeof e.message === 'string' ? e.message : ''));
  if (typeof e?.name === 'string' && /timeout/i.test(e.name)) return new ProviderError('timeout');
  return new ProviderError('unavailable'); // network error; the upstream text is deliberately dropped
}

export function createAnthropicProvider(config: Config, sdk?: SdkLike): Provider {
  const client: SdkLike = sdk ?? (new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 1 }) as unknown as SdkLike);
  const tools = [{ name: TOOL_NAME, description: 'Record the recipe exactly as the user stated it.', strict: true, input_schema: recipeToolSchema() }];
  return {
    name: 'anthropic',
    label: 'Claude',
    model: config.anthropicModel,
    async complete(req): Promise<ProviderResult> {
      let res: Anthropic.Message;
      try {
        // Forced tool_choice 400s on current models, so the system prompt demands the tool call instead.
        const stream = client.messages.stream(
          {
            model: config.anthropicModel,
            max_tokens: req.maxTokens,
            system: req.system,
            tools: tools as Anthropic.Tool[],
            tool_choice: { type: 'auto' },
            output_config: { effort: 'low' },
            messages: toMessages(req.messages),
          },
          { timeout: req.timeoutMs, signal: req.signal },
        );
        res = await raceAbort(req.signal, stream.finalMessage());
      } catch (err) {
        throw toProviderError(err, req.signal);
      }
      if (res.stop_reason === 'refusal') return { kind: 'refusal' };
      // Truncated tool input can still validate (gaps is last), so never accept it.
      if (res.stop_reason === 'max_tokens') return { kind: 'truncated' };
      const block = res.content.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME);
      if (block && block.type === 'tool_use') return { kind: 'draft', input: block.input, raw: res.content };
      return { kind: 'no_draft', raw: res.content };
    },
  };
}
