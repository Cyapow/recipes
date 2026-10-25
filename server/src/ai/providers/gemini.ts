import type { Config } from '../../config.js';
import { JSON_MODE_NOTE, nullableAsTypeArray, recipeToolSchema } from '../draft.js';
import { postJson, ProviderError, type Provider, type ProviderMessage, type ProviderResult } from './types.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const REFUSAL_FINISH = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'RECITATION', 'BLOCKLIST', 'SPII']);

/**
 * Gemini accepts a JSON Schema subset: type (lowercase), properties, required, additionalProperties, items, enum,
 * description; nullable as a type array. Our strict-safe schema already stays inside that subset.
 */
export function geminiSchema(): Record<string, unknown> {
  return nullableAsTypeArray(recipeToolSchema()) as Record<string, unknown>;
}

function toContents(messages: ProviderMessage[]) {
  const out: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', parts: [{ text: m.text }] });
      continue;
    }
    out.push({ role: 'model', parts: [{ text: typeof m.raw === 'string' && m.raw !== '' ? m.raw : '(no recipe returned)' }] });
    out.push({
      role: 'user',
      parts: [{
        text:
          m.problem === null
            ? 'Reply only with the recipe as a JSON object matching the schema. Do not add anything the user did not say.'
            : `Invalid recipe: ${m.problem}\nReturn the recipe again with valid fields; do not add anything the user did not say.`,
      }],
    });
  }
  return out;
}

type GenResponse = {
  promptFeedback?: { blockReason?: string };
  candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
};

export function createGeminiProvider(config: Config, fetchImpl: typeof fetch = fetch): Provider {
  const schema = geminiSchema();
  const model = config.geminiModel;
  return {
    name: 'gemini',
    label: 'Gemini',
    model,
    async complete(req): Promise<ProviderResult> {
      const data = (await postJson(
        fetchImpl,
        `${BASE}/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': config.geminiApiKey ?? '' },
        {
          systemInstruction: { parts: [{ text: `${req.system}\n\n${JSON_MODE_NOTE}` }] },
          contents: toContents(req.messages),
          generationConfig: {
            maxOutputTokens: req.maxTokens,
            responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } },
          },
        },
        req.signal,
      )) as GenResponse | null;
      if (data?.promptFeedback?.blockReason) return { kind: 'refusal' };
      const cand = data?.candidates?.[0];
      if (!cand) throw new ProviderError('unavailable');
      if (cand.finishReason && REFUSAL_FINISH.has(cand.finishReason)) return { kind: 'refusal' };
      if (cand.finishReason === 'MAX_TOKENS') return { kind: 'truncated' };
      const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
      try {
        return { kind: 'draft', input: JSON.parse(text), raw: text };
      } catch {
        return { kind: 'no_draft', raw: text };
      }
    },
  };
}
