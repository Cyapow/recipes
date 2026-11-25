import Fastify from 'fastify';
import { OAuth2Client, type LoginTicket } from 'google-auth-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db.js';
import { createAuthRepo } from './repo.js';
import { registerAuthRoutes } from './routes.js';
import { createGoogleIdTokenVerifier, type IdTokenVerifier } from './verify.js';

const fake: IdTokenVerifier = async (t) =>
  t === 'good' ? { email: 'Mat@Example.com', emailVerified: true, name: null }
  : t === 'named' ? { email: 'mat@example.com', emailVerified: true, name: 'Mat Chapman' }
  : t === 'renamed' ? { email: 'mat@example.com', emailVerified: true, name: 'Matthew Chapman' }
  : t === 'unverified' ? { email: 'mat@example.com', emailVerified: false, name: null }
  : t === 'stranger' ? { email: 'stranger@example.com', emailVerified: true, name: null }
  : null;

const REFUSAL = "This Google account isn't on the list";

function setup(o: { secureCookie?: boolean; noClient?: boolean; verify?: IdTokenVerifier } = {}) {
  const db = openDb(':memory:');
  const repo = createAuthRepo(db);
  repo.addAllowed('mat@example.com', new Date());
  const app = Fastify();
  registerAuthRoutes(app, {
    repo,
    verify: o.verify ?? fake,
    clientId: o.noClient ? undefined : 'client-id',
    envEmails: ['mat@example.com'],
    secureCookie: o.secureCookie ?? false,
  });
  return { app, db, repo };
}

const signIn = (app: ReturnType<typeof setup>['app'], credential: unknown) =>
  app.inject({ method: 'POST', url: '/api/auth/google', payload: { credential } });
const setCookie = (res: { headers: Record<string, any> }) => String(res.headers['set-cookie']);
const cookieOf = (res: { headers: Record<string, any> }) => setCookie(res).split(';')[0];
const sessionCount = (db: ReturnType<typeof setup>['db']) =>
  (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;

describe('google sign-in', () => {
  it('signs in an allowlisted address and sets a session cookie', async () => {
    const { app, db } = setup();
    const res = await signIn(app, 'good');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: 'mat@example.com' });
    const c = setCookie(res);
    expect(c).toMatch(/^recipes_session=[0-9a-f]{64};/);
    for (const a of ['HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=7776000']) expect(c).toContain(a);
    expect(sessionCount(db)).toBe(1);
  });

  it('omits Secure on http and includes it on https', async () => {
    const http = await signIn(setup({ secureCookie: false }).app, 'good');
    const https = await signIn(setup({ secureCookie: true }).app, 'good');
    expect(setCookie(http)).not.toContain('Secure');
    expect(setCookie(https)).toContain('; Secure');
  });

  it('refuses a bad token, an unverified email and a stranger with the same 403 and message', async () => {
    const { app } = setup();
    for (const t of ['garbage', 'unverified', 'stranger']) {
      const res = await signIn(app, t);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: REFUSAL });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('does not authorise off envEmails: an env address with no table row is refused like a stranger', async () => {
    const { app, repo } = setup();
    repo.removeAllowed('mat@example.com');
    const res = await signIn(app, 'good');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: REFUSAL });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects a token minted for another OAuth client', async () => {
    // the verifier answers null on an audience mismatch
    const { app } = setup();
    const res = await signIn(app, 'other-audience');
    expect(res.statusCode).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('answers 400 when credential is missing or not a string', async () => {
    const { app } = setup();
    for (const payload of [{}, { credential: 7 }, { credential: '' }]) {
      const res = await app.inject({ method: 'POST', url: '/api/auth/google', payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'Missing credential' });
    }
  });

  it('answers 503 when no client ID is configured', async () => {
    const res = await signIn(setup({ noClient: true }).app, 'good');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'Google client not configured' });
  });

  it('prunes expired sessions on sign-in', async () => {
    const { app, db, repo } = setup();
    repo.createSession('old@example.com', new Date('2020-01-01'));
    expect(sessionCount(db)).toBe(1);
    await signIn(app, 'good');
    expect(sessionCount(db)).toBe(1);
  });
});

describe('a blank name claim', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['', '   '])('does not overwrite a stored name when the token carries %j', async (name) => {
    const { app, repo } = setup({ verify: createGoogleIdTokenVerifier('client-id') });
    repo.setDisplayName('mat@example.com', 'Mat Chapman');
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({ email: 'mat@example.com', email_verified: true, name }),
    } as LoginTicket);
    expect((await signIn(app, 'any')).statusCode).toBe(200);
    expect(repo.listAllowed()[0]?.name).toBe('Mat Chapman');
  });
});

describe('auth config, me and signout', () => {
  it('GET /api/auth/config returns the client ID, or null', async () => {
    expect((await setup().app.inject('/api/auth/config')).json()).toEqual({ clientId: 'client-id' });
    expect((await setup({ noClient: true }).app.inject('/api/auth/config')).json()).toEqual({ clientId: null });
  });

  it('GET /api/auth/me returns the signed-in email', async () => {
    const { app } = setup();
    const cookie = cookieOf(await signIn(app, 'good'));
    const res = await app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: 'mat@example.com', name: 'Mat' });
  });

  it('stores the name on sign-in and returns it from /api/auth/me', async () => {
    const { app } = setup();
    const cookie = cookieOf(await signIn(app, 'named'));
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(me.json()).toEqual({ email: 'mat@example.com', name: 'Mat Chapman' });
  });

  it('refreshes a changed name on the next sign-in', async () => {
    const { app, repo } = setup();
    await signIn(app, 'named');
    await signIn(app, 'renamed');
    expect(repo.listAllowed()[0]?.name).toBe('Matthew Chapman');
  });

  it('leaves a stored name alone when the token has no name', async () => {
    const { app, repo } = setup();
    await signIn(app, 'named');
    const cookie = cookieOf(await signIn(app, 'good'));
    expect(repo.listAllowed()[0]?.name).toBe('Mat Chapman');
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(me.json().name).toBe('Mat Chapman');
  });

  it('GET /api/auth/me answers 401 without a valid session', async () => {
    const { app } = setup();
    for (const headers of [{}, { cookie: 'recipes_session=nope' }]) {
      const res = await app.inject({ url: '/api/auth/me', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Sign in required' });
    }
  });

  it('POST /api/auth/signout clears the cookie and the row, and the cookie then fails', async () => {
    const { app, db } = setup();
    const cookie = cookieOf(await signIn(app, 'good'));
    const out = await app.inject({ method: 'POST', url: '/api/auth/signout', headers: { cookie } });
    expect(out.statusCode).toBe(200);
    expect(out.json()).toEqual({ ok: true });
    expect(setCookie(out)).toContain('Max-Age=0');
    expect(sessionCount(db)).toBe(0);
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});
