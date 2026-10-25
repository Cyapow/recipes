import type { Config } from '../../config.js';
import { JSON_MODE_NOTE, nullableAsTypeArray, recipeToolSchema, TOOL_NAME } from '../draft.js';
import { postJson, ProviderError, type Provider, type ProviderMessage, type ProviderResult } from './types.js';

const URL_CHAT = 'https://api.openai.com/v1/chat/completions';

/** Strict structured-output schema: the shared strict-safe schema with nullable fields as `["type","null"]`. */
export function openaiSchema(): Record<string, unknown> {
  return nullableAsTypeArray(recipeToolSchema()) as Record<string, unknown>;
}

function toMessages(system: string, messages: ProviderMessage[]) {
  const out: Array<{ role: string; content: string }> = [{ role: 'developer', content: `${system}\n\n${JSON_MODE_NOTE}` }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text });
      continue;
    }
    out.push({ role: 'assistant', content: typeof m.raw === 'string' && m.raw !== '' ? m.raw : '(no recipe returned)' });
    out.push({
      role: 'user',
      content:
        m.problem === null
          ? 'Reply only with the recipe as a JSON object matching the schema. Do not add anything the user did not say.'
          : `Invalid recipe: ${m.problem}\nReturn the recipe again with valid fields; do not add anything the user did not say.`,
    });
  }
  return out;
}

type ChatResponse = {
  choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }>;
};

export function createOpenAiProvider(config: Config, fetchImpl: typeof fetch = fetch): Provider {
  const schema = openaiSchema();
  const model = config.openaiModel;
  return {
    name: 'openai',
    label: 'ChatGPT',
    model,
    async complete(req): Promise<ProviderResult> {
      const data = (await postJson(
        fetchImpl,
        URL_CHAT,
        { authorization: `Bearer ${config.openaiApiKey}` },
        {
          model,
          messages: toMessages(req.system, req.messages),
          response_format: { type: 'json_schema', json_schema: { name: TOOL_NAME, strict: true, schema } },
          max_completion_tokens: req.maxTokens,
          // Effort values are model-specific; an unsupported one is a 400 (surfaced as `other`).
          ...(config.openaiReasoningEffort ? { reasoning_effort: config.openaiReasoningEffort } : {}),
        },
        req.signal,
      )) as ChatResponse | null;
      const choice = data?.choices?.[0];
      if (!choice) throw new ProviderError('unavailable');
      if (choice.message?.refusal || choice.finish_reason === 'content_filter') return { kind: 'refusal' };
      if (choice.finish_reason === 'length') return { kind: 'truncated' };
      const text = choice.message?.content ?? '';
      try {
        return { kind: 'draft', input: JSON.parse(text), raw: text };
      } catch {
        return { kind: 'no_draft', raw: text };
      }
    },
  };
}
