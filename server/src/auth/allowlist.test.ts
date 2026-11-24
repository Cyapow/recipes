import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { createAuthRepo } from './repo.js';
import { signedIn } from './testing.js';
import type { IdTokenVerifier } from './verify.js';

const verify: IdTokenVerifier = async (t) => ({ email: t, emailVerified: true });

const ENV_EMAIL = 'mat@example.com';
const SELF = 'cook@example.com';
const ENV_REFUSAL = "That address is set in the server's .env and can't be removed here.";

function setup() {
  const db = openDb(':memory:');
  const config = {
    ...loadConfig({}),
    dataDir: mkdtempSync(path.join(tmpdir(), 'allowlist-')),
    googleClientId: 'client-id',
    allowedEmails: [ENV_EMAIL],
  };
  const app = signedIn(buildApp({ config, db, verify }), db, SELF);
  const repo = createAuthRepo(db);
  repo.addAllowed(ENV_EMAIL, new Date());
  return { app, db, repo };
}

const add = (app: ReturnType<typeof setup>['app'], email: unknown) =>
  app.inject({ method: 'POST', url: '/api/auth/allowed', payload: { email } });
const remove = (app: ReturnType<typeof setup>['app'], email: string) =>
  app.inject({ method: 'DELETE', url: `/api/auth/allowed/${encodeURIComponent(email)}` });

describe('allowlist management', () => {
  it('lists addresses with a fromEnv flag', async () => {
    const { app, repo } = setup();
    repo.addAllowed('wife@example.com', new Date());
    const res = await app.inject({ method: 'GET', url: '/api/auth/allowed' });
    expect(res.statusCode).toBe(200);
    const emails = res.json().emails as { email: string; addedAt: string; fromEnv: boolean }[];
    expect(emails.map((e) => [e.email, e.fromEnv])).toEqual([
      [SELF, false],
      [ENV_EMAIL, true],
      ['wife@example.com', false],
    ]);
    expect(emails.every((e) => !Number.isNaN(Date.parse(e.addedAt)))).toBe(true);
  });

  it('adds an address, normalised', async () => {
    const { app, repo } = setup();
    const res = await add(app, ' Wife@Example.com ');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(repo.isAllowed('wife@example.com')).toBe(true);
    const list = await app.inject({ method: 'GET', url: '/api/auth/allowed' });
    expect(list.json().emails.map((e: { email: string }) => e.email)).toContain('wife@example.com');
  });

  it.each(['', 'nope', 'a@b', '@example.com', 'two@@example.com', 'a b@example.com', 'a@exa mple.com', 42, null])(
    'rejects %j with 400',
    async (email) => {
      const { app, repo } = setup();
      const before = repo.listAllowed().length;
      const res = await add(app, email);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "That doesn't look like an email address" });
      expect(repo.listAllowed()).toHaveLength(before);
    },
  );

  it('requires a session', async () => {
    const { app } = setup();
    const res = await app.injectAnon({ method: 'GET', url: '/api/auth/allowed' });
    expect(res.statusCode).toBe(401);
  });

  it('removing an address revokes its live session on the very next request', async () => {
    const { app } = setup();
    await add(app, 'wife@example.com');
    const signIn = await app.injectAnon({ method: 'POST', url: '/api/auth/google', payload: { credential: 'wife@example.com' } });
    expect(signIn.statusCode).toBe(200);
    const wifeCookie = String(signIn.headers['set-cookie']).split(';')[0]!;

    const before = await app.injectAnon({ method: 'GET', url: '/api/recipes', headers: { cookie: wifeCookie } });
    expect(before.statusCode).toBe(200);

    const del = await remove(app, 'wife@example.com');
    expect(del.statusCode).toBe(200);
    expect(del.json()).toEqual({ ok: true });

    const after = await app.injectAnon({ method: 'GET', url: '/api/recipes', headers: { cookie: wifeCookie } });
    expect(after.statusCode).toBe(401);
    const again = await app.injectAnon({ method: 'POST', url: '/api/auth/google', payload: { credential: 'wife@example.com' } });
    expect(again.statusCode).toBe(403);
  });

  it('refuses to remove the last remaining address', async () => {
    const { app, db, repo } = setup();
    // The caller's session outlives their own row here; the guard only reads sessions.
    db.prepare('DELETE FROM allowed_emails WHERE email IN (?, ?)').run(SELF, ENV_EMAIL);
    repo.addAllowed('wife@example.com', new Date());
    const res = await remove(app, 'wife@example.com');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'That is the only address left. Add another first.' });
    expect(repo.isAllowed('wife@example.com')).toBe(true);
  });

  it('refuses to remove your own address', async () => {
    const { app, repo } = setup();
    const res = await remove(app, SELF);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "That's you. Someone else has to remove your access." });
    expect(repo.isAllowed(SELF)).toBe(true);
  });

  it('refuses to remove an address set in .env, whatever its case', async () => {
    const { app, repo } = setup();
    for (const email of [ENV_EMAIL, 'MAT@Example.com']) {
      const res = await remove(app, email);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: ENV_REFUSAL });
    }
    expect(repo.isAllowed(ENV_EMAIL)).toBe(true);
  });

  it('names the env refusal before the self one when both apply', async () => {
    const db = openDb(':memory:');
    const config = { ...loadConfig({}), dataDir: mkdtempSync(path.join(tmpdir(), 'allowlist-')), allowedEmails: [SELF] };
    const app = signedIn(buildApp({ config, db }), db, SELF);
    const res = await remove(app, SELF);
    expect(res.json()).toEqual({ error: ENV_REFUSAL });
  });

  it('removing an unknown address is 404', async () => {
    const { app } = setup();
    const res = await remove(app, 'ghost@example.com');
    expect(res.statusCode).toBe(404);
  });
});
