import type { FastifyInstance } from 'fastify';
import { cookieAttrs, readCookie } from '../cookies.js';
import { normaliseEmail, SESSION_TTL_MS, type AuthRepo } from './repo.js';
import { createGoogleIdTokenVerifier, type IdTokenVerifier } from './verify.js';

export const SESSION_COOKIE = 'recipes_session';
const REFUSAL = "This Google account isn't on the list";

// One permissive check, not an RFC parser: Google is the real check on who can sign in.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
// The longest address SMTP allows; without it the shape check would accept a 10KB string.
const EMAIL_MAX = 254;

/** null yields the clearing cookie. */
export function sessionCookie(token: string | null, secure: boolean): string {
  const maxAge = token === null ? 0 : SESSION_TTL_MS / 1000;
  return `${SESSION_COOKIE}=${token ?? ''}; Max-Age=${maxAge}; ${cookieAttrs({ path: '/', secure })}`;
}

export function readSessionCookie(header: string | undefined): string | undefined {
  return readCookie(header, SESSION_COOKIE) || undefined;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  deps: {
    repo: AuthRepo;
    verify?: IdTokenVerifier;
    clientId?: string;
    envEmails: string[];
    /** Required: a silent insecure default in a session-cookie helper is not worth the convenience. */
    secureCookie: boolean;
    now?: () => number;
  },
): void {
  const now = deps.now ?? Date.now;
  const secure = deps.secureCookie;
  const verify = deps.verify ?? (deps.clientId ? createGoogleIdTokenVerifier(deps.clientId) : undefined);

  app.get('/api/auth/config', async () => ({ clientId: deps.clientId ?? null }));

  app.post('/api/auth/google', async (req, reply) => {
    if (!deps.clientId || !verify) return reply.code(503).send({ error: 'Google client not configured' });
    const credential = (req.body as { credential?: unknown } | null)?.credential;
    if (typeof credential !== 'string' || !credential) return reply.code(400).send({ error: 'Missing credential' });

    // Every refusal is the same response so the endpoint never reveals who is allowed.
    const identity = await verify(credential);
    if (!identity?.emailVerified) return reply.code(403).send({ error: REFUSAL });
    const email = normaliseEmail(identity.email);
    if (!deps.repo.isAllowed(email)) return reply.code(403).send({ error: REFUSAL });

    const at = new Date(now());
    deps.repo.pruneSessions(at);
    const token = deps.repo.createSession(email, at);
    reply.header('set-cookie', sessionCookie(token, secure));
    return { email };
  });

  // Reads the session itself so it does not depend on any global guard.
  app.get('/api/auth/me', async (req, reply) => {
    const token = readSessionCookie(req.headers.cookie);
    const email = req.email ?? (token ? deps.repo.sessionEmail(token, new Date(now())) : null);
    if (!email) return reply.code(401).send({ error: 'Sign in required' });
    return { email };
  });

  app.post('/api/auth/signout', async (req, reply) => {
    const token = readSessionCookie(req.headers.cookie);
    if (token) deps.repo.deleteSession(token);
    reply.header('set-cookie', sessionCookie(null, secure));
    return { ok: true };
  });

  app.get('/api/auth/allowed', async () => ({
    emails: deps.repo.listAllowed().map((a) => ({ ...a, fromEnv: deps.envEmails.includes(a.email) })),
  }));

  app.post('/api/auth/allowed', async (req, reply) => {
    const raw = (req.body as { email?: unknown } | null)?.email;
    const email = typeof raw === 'string' ? normaliseEmail(raw) : '';
    if (email.length > EMAIL_MAX || !EMAIL_SHAPE.test(email)) {
      return reply.code(400).send({ error: "That doesn't look like an email address" });
    }
    deps.repo.addAllowed(email, new Date(now()));
    return { ok: true };
  });

  // The refusals run most specific first, so the message names the real reason.
  app.delete('/api/auth/allowed/:email', async (req, reply) => {
    const email = normaliseEmail((req.params as { email: string }).email);
    if (deps.envEmails.includes(email)) {
      return reply.code(409).send({ error: "That address is set in the server's .env and can't be removed here." });
    }
    if (email === req.email) return reply.code(409).send({ error: "That's you. Someone else has to remove your access." });
    if (!deps.repo.isAllowed(email)) return reply.code(404).send({ error: 'That address is not on the list' });
    if (deps.repo.listAllowed().length <= 1) {
      return reply.code(409).send({ error: 'That is the only address left. Add another first.' });
    }
    deps.repo.removeAllowed(email);
    return { ok: true };
  });
}
