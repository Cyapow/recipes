import type { AiProviderName } from '../api';

export const AI_LABELS: Record<AiProviderName, string> = { anthropic: 'Claude', openai: 'ChatGPT', gemini: 'Gemini' };

/** "Drafted by ChatGPT", or null when the server did not say (or named something we do not know). */
export const draftedBy = (provider: string | undefined): string | null =>
  provider && provider in AI_LABELS ? `Drafted by ${AI_LABELS[provider as AiProviderName]}` : null;
