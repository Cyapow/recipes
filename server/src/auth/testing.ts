import type { Database } from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { createAuthRepo } from './repo.js';
import { SESSION_COOKIE } from './routes.js';

/** Seeds the allowlist and a session so a test can call guarded routes the way a signed-in browser does. */
export function authHeaders(db: Database, email = 'cook@example.com'): { cookie: string } {
  const repo = createAuthRepo(db);
  const now = new Date();
  repo.addAllowed(email, now);
  return { cookie: `${SESSION_COOKIE}=${repo.createSession(email, now)}` };
}

/**
 * Makes every app.inject carry a real session, for suites that exercise routes rather than the guard. The guard itself
 * stays fully on: the cookie is sent and checked like a browser's, alongside any cookie a test sends itself.
 */
export function signedIn<T extends FastifyInstance>(app: T, db: Database, email?: string): T {
  const headers = authHeaders(db, email);
  const inject = app.inject.bind(app) as (opts: object) => unknown;
  app.inject = ((opts: string | { headers?: { cookie?: string } }) => {
    if (typeof opts === 'string') return inject({ url: opts, headers });
    const own = opts.headers?.cookie;
    return inject({ ...opts, headers: { ...opts.headers, cookie: own ? `${headers.cookie}; ${own}` : headers.cookie } });
  }) as never;
  return app;
}
