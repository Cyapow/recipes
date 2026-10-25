/** Fastify logger config: warn-level in production, silent under vitest, and no secrets in log lines. */
export function loggerOptions(env: NodeJS.ProcessEnv) {
  if (env.VITEST) return false;
  return {
    level: env.LOG_LEVEL || 'warn',
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    serializers: {
      // Never log the query string: the OAuth callback carries the authorisation code and state there.
      req(req: { method?: string; url?: string; hostname?: string; remoteAddress?: string }) {
        return { method: req.method, url: (req.url ?? '').split('?')[0], hostname: req.hostname, remoteAddress: req.remoteAddress };
      },
    },
  };
}
