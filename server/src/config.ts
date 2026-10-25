export type AiProviderName = 'anthropic' | 'openai' | 'gemini';

export type Config = {
  port: number;
  dataDir: string;
  anthropicApiKey?: string;
  anthropicModel: string;
  openaiApiKey?: string;
  openaiModel: string;
  geminiApiKey?: string;
  geminiModel: string;
  /** Forces the first provider tried; unset means the first one with a key (Claude, ChatGPT, Gemini). */
  aiProvider?: AiProviderName;
  /** Sent as reasoning_effort to OpenAI; undefined = omit the field (models without the parameter). */
  openaiReasoningEffort?: string;
  /** Sent as thinkingConfig.thinkingLevel to Gemini; undefined = omit. */
  geminiThinkingLevel?: string;
  /** One deadline across the whole AI call, all providers and retries included. */
  aiTotalTimeoutMs: number;
  googleClientId?: string;
  googleClientSecret?: string;
  publicBaseUrl: string;
  backupHour: number;
};

// Inexpensive, structured-output-capable defaults; override with OPENAI_MODEL / GEMINI_MODEL.
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

function parseProvider(v: string | undefined): AiProviderName | undefined {
  const s = v?.trim().toLowerCase();
  if (!s) return undefined;
  if (s === 'anthropic' || s === 'openai' || s === 'gemini') return s;
  console.warn('AI_PROVIDER must be anthropic, openai or gemini; ignoring it and using the first provider that has a key.');
  return undefined;
}

const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const LEVELS = ['minimal', 'low', 'medium', 'high'];
const DEFAULT_TOTAL_TIMEOUT_MS = 100_000;
const MIN_TOTAL_TIMEOUT_MS = 10_000;

/** Unset -> `low`; empty or `default` -> undefined (omit); an unknown value is ignored with a warning. */
function parseChoice(name: string, v: string | undefined, allowed: string[]): string | undefined {
  if (v === undefined) return 'low';
  const s = v.trim().toLowerCase();
  if (s === '' || s === 'default') return undefined;
  if (allowed.includes(s)) return s;
  console.warn(`${name} must be one of ${allowed.join(', ')} or default; using low.`);
  return 'low';
}

function parseTotalTimeout(v: string | undefined): number {
  const n = Number(v?.trim());
  if (!v?.trim() || !Number.isFinite(n) || n <= 0) return DEFAULT_TOTAL_TIMEOUT_MS;
  return Math.max(MIN_TOTAL_TIMEOUT_MS, Math.floor(n));
}

export function loadConfig(raw: NodeJS.ProcessEnv): Config {
  // A whitespace-only value counts as unset; keys and names are used trimmed.
  const env: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, k === 'OPENAI_REASONING_EFFORT' || k === 'GEMINI_THINKING_LEVEL' ? v : v?.trim()]),
  );
  return {
    port: Number(env.PORT) || 3000,
    dataDir: env.DATA_DIR || '/data',
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    openaiApiKey: env.OPENAI_API_KEY || undefined,
    openaiModel: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    geminiApiKey: env.GEMINI_API_KEY || undefined,
    geminiModel: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    aiProvider: parseProvider(env.AI_PROVIDER),
    openaiReasoningEffort: parseChoice('OPENAI_REASONING_EFFORT', env.OPENAI_REASONING_EFFORT, EFFORTS),
    geminiThinkingLevel: parseChoice('GEMINI_THINKING_LEVEL', env.GEMINI_THINKING_LEVEL, LEVELS),
    aiTotalTimeoutMs: parseTotalTimeout(env.AI_TOTAL_TIMEOUT_MS),
    googleClientId: env.GOOGLE_CLIENT_ID || undefined,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || undefined,
    publicBaseUrl: env.PUBLIC_BASE_URL || 'http://localhost:3000',
    backupHour: parseHour(env.BACKUP_HOUR),
  };
}

function parseHour(v: string | undefined): number {
  if (v === undefined || v.trim() === '') return 3;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : 3;
}
