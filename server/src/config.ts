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

export function loadConfig(env: NodeJS.ProcessEnv): Config {
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
