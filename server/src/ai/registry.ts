import type { Config } from '../config.js';
import { PROVIDER_NAMES, type ProviderName } from './providers/types.js';

export const PROVIDER_LABELS: Record<ProviderName, string> = { anthropic: 'Claude', openai: 'ChatGPT', gemini: 'Gemini' };

const keyOf = (c: Config, n: ProviderName): string | undefined =>
  ({ anthropic: c.anthropicApiKey, openai: c.openaiApiKey, gemini: c.geminiApiKey })[n] || undefined;
const modelOf = (c: Config, n: ProviderName): string => ({ anthropic: c.anthropicModel, openai: c.openaiModel, gemini: c.geminiModel })[n];

/** Providers that have a key, in the order they are tried: the forced one first, then the default order. */
export function providerOrder(config: Config): ProviderName[] {
  const configured = PROVIDER_NAMES.filter((n) => keyOf(config, n));
  const first = config.aiProvider && configured.includes(config.aiProvider) ? config.aiProvider : undefined;
  return first ? [first, ...configured.filter((n) => n !== first)] : [...configured];
}

export type AiStatus = {
  providers: Array<{ name: ProviderName; label: string; configured: boolean; model: string }>;
  active: ProviderName | null;
};

/** Safe to send to the browser: names, labels and models only, never a key. */
export function aiStatus(config: Config): AiStatus {
  return {
    providers: PROVIDER_NAMES.map((name) => ({ name, label: PROVIDER_LABELS[name], configured: Boolean(keyOf(config, name)), model: modelOf(config, name) })),
    active: providerOrder(config)[0] ?? null,
  };
}
