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
 * Every app.inject on an app built through this helper carries a session (the guard stays fully on and checks the
 * cookie like a browser's); use app.injectAnon, the original inject, to test signed-out behaviour.
 */
export function signedIn<T extends FastifyInstance>(app: T, db: Database, email?: string): T & { injectAnon: T['inject'] } {
  const headers = authHeaders(db, email);
  const anon = app.inject.bind(app);
  const inject = anon as (opts: object) => unknown;
  app.inject = ((opts: string | { headers?: { cookie?: string } }) => {
    if (typeof opts === 'string') return inject({ url: opts, headers });
    const own = opts.headers?.cookie;
    return inject({ ...opts, headers: { ...opts.headers, cookie: own ? `${headers.cookie}; ${own}` : headers.cookie } });
  }) as never;
  return Object.assign(app, { injectAnon: anon });
}
