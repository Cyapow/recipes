import type { FastifyInstance } from 'fastify';
import type { AuthRepo } from './repo.js';
import { readSessionCookie } from './routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    email?: string;
  }
}

const OPEN_API = new Set(['/api/health', '/api/auth/config', '/api/auth/google']);

/**
 * Takes a decoded path. Every non-/api path is open: those serve the SPA shell or the PWA's own files (sw.js, the
 * manifest, icons, /assets), which a signed-out browser needs to render its sign-in screen. None of them carry data.
 */
export function isOpenPath(pathname: string): boolean {
  if (pathname === '/api' || pathname.startsWith('/api/')) return OPEN_API.has(pathname);
  return true;
}

function decodedPathname(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url, 'http://x').pathname);
  } catch {
    return null; // undecodable: the router cannot match it either, so treat it as guarded
  }
}

/**
 * An onRequest hook, so it runs before body parsing and covers routes added later. The path is decoded rather than
 * prefix-tested (as in security.ts): the router decodes, so /%61pi/... reaches /api/... handlers. The matched route
 * pattern is checked too, and both must be open.
 */
export function registerAuthGuard(app: FastifyInstance, deps: { repo: AuthRepo; now?: () => number }): void {
  const now = deps.now ?? Date.now;

  app.addHook('onRequest', async (req, reply) => {
    const pathname = decodedPathname(req.url);
    const pattern = req.routeOptions.url;
    if (pathname !== null && isOpenPath(pathname) && (pattern === undefined || isOpenPath(pattern))) return;

    const token = readSessionCookie(req.headers.cookie);
    const email = token ? deps.repo.sessionEmail(token, new Date(now())) : null;
    if (!email) return reply.code(401).send({ error: 'Sign in required' });
    req.email = email;
  });
}
