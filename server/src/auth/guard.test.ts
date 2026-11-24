import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { isOpenPath } from './guard.js';
import { createAuthRepo, SESSION_TTL_MS } from './repo.js';
import { authHeaders } from './testing.js';
import type { IdTokenVerifier } from './verify.js';

const DAY = 24 * 3600 * 1000;

function setup(o: { webDir?: string; publicBaseUrl?: string; verify?: IdTokenVerifier } = {}) {
  const db = openDb(':memory:');
  const dataDir = mkdtempSync(path.join(tmpdir(), 'guard-'));
  const config = {
    ...loadConfig({}),
    dataDir,
    publicBaseUrl: o.publicBaseUrl ?? 'http://localhost:3000',
    googleClientId: 'client-id',
    allowedEmails: ['cook@example.com'],
  };
  const app = buildApp({ config, db, webDir: o.webDir, verify: o.verify });
  return { app, db };
}

describe('isOpenPath', () => {
  it.each(['/api/health', '/api/auth/config', '/api/auth/google', '/sw.js', '/manifest.webmanifest',
           '/assets/index-abc123.js', '/icon-192.png', '/apple-touch-icon.png', '/icon.svg',
           '/', '/settings', '/recipe/abc/cook', '/Assets/index-ABC.js', '/Sw.js'])('%s is open', (p) => expect(isOpenPath(p)).toBe(true));
  it.each(['/api/recipes', '/api/shopping', '/api/images/upload', '/api/backup/status',
           '/api/auth/me', '/api/auth/allowed', '/api',
           '/api/healthz', '/api/auth/configure', '//api/recipes', '/API/recipes', '/Api/recipes', '/api//recipes'])('%s is guarded', (p) => expect(isOpenPath(p)).toBe(false));
});

describe('auth guard', () => {
  it('a guarded API route without a cookie is 401 JSON', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/recipes' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Sign in required' });
  });

  it.each(['/%61pi/recipes', '/%2561pi/recipes', '//api/recipes', '/API/recipes', '/api//recipes', '/api/healthz', '/api/auth/configure'])(
    '%s does not slip past the guard',
    async (url) => {
      const { app } = setup();
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    },
  );

  it('a guarded API route with a seeded session passes', async () => {
    const { app, db } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/recipes', headers: authHeaders(db) });
    expect(res.statusCode).toBe(200);
  });

  it('open routes need no session', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/config' })).json()).toEqual({ clientId: 'client-id' });
  });

  it('/api/auth/me answers for a signed-in cookie and 401s otherwise', async () => {
    const { app, db } = setup();
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: authHeaders(db) });
    expect(res.json()).toEqual({ email: 'cook@example.com' });
  });

  it('an unknown or expired cookie is a clean 401, not a 500', async () => {
    const { app, db } = setup();
    const unknown = await app.inject({ method: 'GET', url: '/api/recipes', headers: { cookie: 'recipes_session=deadbeef' } });
    expect(unknown.statusCode).toBe(401);

    const repo = createAuthRepo(db);
    repo.addAllowed('cook@example.com', new Date());
    const old = repo.createSession('cook@example.com', new Date(Date.now() - SESSION_TTL_MS - DAY));
    const expired = await app.inject({ method: 'GET', url: '/api/recipes', headers: { cookie: `recipes_session=${old}` } });
    expect(expired.statusCode).toBe(401);
  });

  it('a page route still returns the SPA shell when signed out', async () => {
    const webDir = mkdtempSync(path.join(tmpdir(), 'web-'));
    writeFileSync(path.join(webDir, 'index.html'), '<html>SHELL</html>');
    writeFileSync(path.join(webDir, 'sw.js'), '// sw');
    mkdirSync(path.join(webDir, 'assets'));
    writeFileSync(path.join(webDir, 'assets', 'a.js'), '// a');
    const { app } = setup({ webDir });
    const page = await app.inject({ method: 'GET', url: '/settings' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('SHELL');
    expect((await app.inject({ method: 'GET', url: '/sw.js' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/assets/a.js' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/nope' })).statusCode).toBe(401);
  });

  it('a signed-out multipart upload is 401 before the body is read', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/images',
      headers: { 'content-type': 'multipart/form-data; boundary=XX' },
      payload: '--XX\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\nx\r\n--XX--\r\n',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('session cookie Secure attribute follows PUBLIC_BASE_URL', () => {
  const verify: IdTokenVerifier = async () => ({ email: 'cook@example.com', emailVerified: true });
  const signIn = (publicBaseUrl: string) => {
    const { app, db } = setup({ publicBaseUrl, verify });
    authHeaders(db); // the allowlist is seeded at boot in index.ts, not by buildApp
    return app.inject({ method: 'POST', url: '/api/auth/google', payload: { credential: 'x' } });
  };
  it('adds Secure over https', async () => {
    const res = await signIn('https://recipes.example.dev');
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toContain('Secure');
  });
  it('omits Secure over http', async () => {
    const res = await signIn('http://localhost:3000');
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).not.toContain('Secure');
  });
});
