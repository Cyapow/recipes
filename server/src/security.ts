import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Blocks cross-site browser requests to state-changing /api routes (CSRF). Requests that send neither
 * Sec-Fetch-Site nor Origin (curl, server-to-server, tests) are allowed; GET navigations (OAuth) are untouched.
 */
export function registerSameOriginGuard(app: FastifyInstance, config: Pick<Config, 'publicBaseUrl'>): void {
  let publicOrigin: string | null = null;
  try {
    publicOrigin = new URL(config.publicBaseUrl).origin;
  } catch {
    // no usable public URL: only the Host header can match
  }

  app.addHook('onRequest', async (req, reply) => {
    if (SAFE_METHODS.has(req.method) || !req.url.startsWith('/api/')) return;
    const deny = () => reply.code(403).send({ error: 'Cross-site request blocked' });

    const site = req.headers['sec-fetch-site'];
    if (typeof site === 'string') {
      if (site !== 'same-origin' && site !== 'none') return deny();
      return;
    }
    const origin = req.headers.origin;
    if (typeof origin === 'string') {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        return deny(); // e.g. "null"
      }
      if (parsed.host !== req.headers.host && parsed.origin !== publicOrigin) return deny();
    }
  });
}
