import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from './db.js';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

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

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const app = buildApp({ config: loadConfig({}), db: openDb(':memory:') });
    const res = await app.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});

describe('static web serving', () => {
  it('serves index.html as SPA fallback but keeps /api 404s as JSON', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'web-'));
    writeFileSync(path.join(dir, 'index.html'), '<html>spa</html>');
    const app = buildApp({ config: loadConfig({}), db: openDb(':memory:'), webDir: dir });
    const page = await app.inject({ url: '/recipe/abc/edit' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('spa');
    expect((await app.inject({ url: '/' })).body).toContain('spa');
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
    const app = buildApp({ config: loadConfig({}), db: openDb(':memory:'), webDir: dir });
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
    const app = buildApp({ config: loadConfig({}), db: openDb(':memory:'), webDir: '/nonexistent-web' });
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(200);
    await app.close();
  });
});
