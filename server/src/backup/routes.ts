import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { GoogleAuth } from './google.js';
import type { BackupService } from './service.js';
import { deriveBanner, getBackupStatus } from './status.js';

const COOKIE = 'recipes_oauth_state';
const COOKIE_PATH = '/api/backup/google';
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_STATES = 100;

export function registerBackupRoutes(
  app: FastifyInstance,
  deps: { db: Database; google: GoogleAuth; service: BackupService; now?: () => number; secureCookie?: boolean },
): void {
  const now = deps.now ?? Date.now;
  const states = new Map<string, number>(); // state -> expiry, one-time use

  const prune = () => {
    for (const [s, exp] of states) if (exp <= now()) states.delete(s);
    while (states.size >= MAX_STATES) states.delete(states.keys().next().value as string);
  };
  const consume = (state: unknown): boolean => {
    if (typeof state !== 'string') return false;
    const exp = states.get(state);
    states.delete(state);
    return exp !== undefined && exp > now();
  };

  const cookieAttrs = `Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax${deps.secureCookie ? '; Secure' : ''}`;
  const readCookie = (header: string | undefined): string | undefined => {
    for (const part of (header ?? '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return v.join('=');
    }
    return undefined;
  };

  app.get('/api/backup/google/start', async (_req, reply) => {
    if (!deps.google.configured) return reply.code(503).send({ error: 'Google client not configured' });
    if ((await deps.google.account()) !== null) {
      return reply.code(409).send({ error: 'Already connected. Disconnect first.' });
    }
    prune();
    const state = randomBytes(32).toString('hex');
    states.set(state, now() + STATE_TTL_MS);
    reply.header('set-cookie', `${COOKIE}=${state}; Max-Age=${STATE_TTL_MS / 1000}; ${cookieAttrs}`);
    return reply.redirect(deps.google.authUrl(state), 302);
  });

  app.get('/api/backup/google/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const cookie = readCookie(req.headers.cookie);
    reply.header('set-cookie', `${COOKIE}=; Max-Age=0; ${cookieAttrs}`);
    const valid = consume(q.state);
    if (!valid || !cookie || cookie !== q.state) return reply.code(400).send({ error: 'Invalid or expired state' });
    if (q.error) return reply.redirect('/settings?google=denied', 302);
    if (typeof q.code !== 'string' || !q.code) return reply.code(400).send({ error: 'Missing code' });
    try {
      await deps.google.handleCallback(q.code);
    } catch (e) {
      req.log.error({ err: e }, 'google callback failed');
      return reply.redirect('/settings?google=failed', 302);
    }
    return reply.redirect('/settings', 302);
  });

  app.post('/api/backup/google/disconnect', async () => {
    await deps.google.disconnect();
    return { ok: true };
  });

  app.get('/api/backup/status', async () => {
    const account = deps.google.configured ? await deps.google.account() : null; // a token without a client can't work
    const status = getBackupStatus(deps.db);
    const since = account?.connectedAt ? new Date(account.connectedAt) : null;
    const connectedSince = since && !Number.isNaN(since.getTime()) ? since : null;
    const banner = deriveBanner(
      account ? { connected: true, connectedSince, ...status } : { connected: false, ...status },
      new Date(now()),
    );
    return {
      configured: deps.google.configured,
      connected: account !== null,
      account: account?.email ?? null,
      banner,
      ...status,
      running: deps.service.isRunning(),
    };
  });

  app.post('/api/backup/run', async (_req, reply) => {
    const out = await deps.service.runNow();
    if (out.status === 'busy') return reply.code(409).send({ error: 'A backup is already running' });
    if (out.status === 'not_connected') return reply.code(409).send({ error: 'Google Drive is not connected' });
    return out.result;
  });
}
