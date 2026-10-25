export type Config = {
  port: number;
  dataDir: string;
  anthropicApiKey?: string;
  anthropicModel: string;
  googleClientId?: string;
  googleClientSecret?: string;
  publicBaseUrl: string;
  backupHour: number;
};

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: Number(env.PORT) || 3000,
    dataDir: env.DATA_DIR || '/data',
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
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
