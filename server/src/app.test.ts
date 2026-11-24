import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { signedIn } from './auth/testing.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({});
    expect(c.port).toBe(3000);
    expect(c.anthropicModel).toBe('claude-sonnet-5-5');
    expect(c.backupHour).toBe(3);
    expect(c.dataDir).toBe('/data');
  });
});

describe('BACKUP_HOUR', () => {
  it.each([['5', 5], ['0', 0], ['23', 23], ['24', 3], ['-1', 3], ['abc', 3], ['2.5', 3], ['', 3]])('%j -> %i', (v, want) =>
    expect(loadConfig({ BACKUP_HOUR: v }).backupHour).toBe(want));
});

describe('ALLOWED_EMAILS', () => {
  it.each([
    ['', []],
    ['me@example.com', ['me@example.com']],
    [' Me@Example.com , you@example.com ', ['me@example.com', 'you@example.com']],
    ['me@example.com,me@example.com', ['me@example.com']],
    [',,', []],
  ])('%j -> %j', (v, want) => expect(loadConfig({ ALLOWED_EMAILS: v }).allowedEmails).toEqual(want));
  it('defaults to an empty list', () => expect(loadConfig({}).allowedEmails).toEqual([]));
});

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const db = openDb(':memory:');
    const app = signedIn(buildApp({ config: loadConfig({}), db }), db);
    const res = await app.injectAnon({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});

describe('static web serving', () => {
  it('serves index.html as SPA fallback but keeps /api 404s as JSON', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'web-'));
    writeFileSync(path.join(dir, 'index.html'), '<html>spa</html>');
    const db = openDb(':memory:');
    const app = signedIn(buildApp({ config: loadConfig({}), db, webDir: dir }), db);
    const page = await app.inject({ url: '/recipe/abc/edit' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('spa');
    expect((await app.inject({ url: '/' })).body).toContain('spa');
    // The guard narrows the old cookie-less contract: signed out is 401, and only a session reaches the 404.
    const signedOut = await app.injectAnon({ url: '/api/nope' });
    expect(signedOut.statusCode).toBe(401);
    expect(signedOut.json()).toEqual({ error: 'Sign in required' });
    const api = await app.inject({ url: '/api/nope' });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: 'Not found' });
    await app.close();
    rmSync(dir, { recursive: true });
  });

  it('404s missing files instead of returning index.html, keeping the SPA fallback for extensionless routes', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'web-'));
    writeFileSync(path.join(dir, 'index.html'), '<html>spa</html>');
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'assets', 'app-1.js'), 'ok()');
    const db = openDb(':memory:');
    const app = signedIn(buildApp({ config: loadConfig({}), db, webDir: dir }), db);
    expect((await app.inject({ url: '/assets/app-1.js' })).body).toBe('ok()');
    for (const url of ['/assets/gone-2.js', '/assets/anything', '/missing.js', '/x/y.css', '/icon.png', '/app.js.map', '/manifest.webmanifest', '/assets/gone.js?v=1']) {
      const res = await app.inject({ url });
      expect(res.statusCode, url).toBe(404);
      expect(res.body, url).not.toContain('spa');
    }
    expect((await app.inject({ url: '/recipe/abc' })).statusCode).toBe(200);
    await app.close();
    rmSync(dir, { recursive: true });
  });

  it('does not break when the web dir is absent', async () => {
    const db = openDb(':memory:');
    const app = signedIn(buildApp({ config: loadConfig({}), db, webDir: '/nonexistent-web' }), db);
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
    await app.close();
  });
});
