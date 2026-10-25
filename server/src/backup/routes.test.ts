import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import type { GoogleAuth } from './google.js';
import { FakeDrive } from './fakeDrive.js';

function fakeGoogle(o: { configured?: boolean; connectedAt?: string | null } = {}) {
  const calls = { callback: [] as string[], disconnects: 0 };
  let account: { email: string; connectedAt: string } | null =
    o.connectedAt === null ? null : { email: 'me@x.com', connectedAt: o.connectedAt ?? new Date().toISOString() };
  const g: GoogleAuth = {
    configured: o.configured ?? true,
    authUrl: (state) => `https://accounts.google.com/auth?state=${state}`,
    async handleCallback(code) {
      calls.callback.push(code);
      account = { email: 'me@x.com', connectedAt: new Date().toISOString() };
      return { email: 'me@x.com' };
    },
    getDriveClient: async () => null,
    async disconnect() { calls.disconnects++; account = null; },
    async account() { return account; },
  };
  return { g, calls };
}

function setup(o: Parameters<typeof fakeGoogle>[0] = {}, driveFactory?: () => Promise<any>) {
  const { g, calls } = fakeGoogle(o);
  const dataDir = mkdtempSync(path.join(tmpdir(), 'rt-'));
  const db = openDb(':memory:');
  const app = buildApp({ config: { ...loadConfig({}), dataDir }, db, google: g, driveFactory: driveFactory ?? (async () => (o.connectedAt === null ? null : new FakeDrive())) });
  return { app, calls, db, dataDir };
}
const cookieOf = (res: { headers: Record<string, any> }) => String(res.headers['set-cookie']).split(';')[0];
const stateOf = (location: string) => new URL(location).searchParams.get('state')!;

describe('google oauth routes', () => {
  it('start 503s when not configured', async () => {
    const { app } = setup({ configured: false });
    const res = await app.inject('/api/backup/google/start');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'Google client not configured' });
  });

  it('start redirects to Google with a 64-hex state; callback stores and redirects to /settings', async () => {
    const { app, calls } = setup({ connectedAt: null });
    const start = await app.inject('/api/backup/google/start');
    expect(start.statusCode).toBe(302);
    const state = stateOf(start.headers.location as string);
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    const cb = await app.inject({ url: `/api/backup/google/callback?code=abc&state=${state}`, headers: { cookie: cookieOf(start) } });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('/settings');
    expect(String(cb.headers['set-cookie'])).toContain('Max-Age=0');
    expect(calls.callback).toEqual(['abc']);
  });

  it('start sets an httpOnly SameSite=Lax cookie scoped to the oauth path, Secure on https', async () => {
    const { app } = setup({ connectedAt: null });
    const res = await app.inject('/api/backup/google/start');
    const c = String(res.headers['set-cookie']);
    const state = stateOf(res.headers.location as string);
    expect(c).toContain(`recipes_oauth_state=${state}`);
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Lax/);
    expect(c).toContain('Path=/api/backup/google');
    expect(c).toContain('Max-Age=600');
    expect(c).not.toContain('Secure'); // default config is http://localhost
    const dataDir = mkdtempSync(path.join(tmpdir(), 'rt-'));
    const secure = buildApp({ config: { ...loadConfig({ PUBLIC_BASE_URL: 'https://recipes.matchapman.dev' }), dataDir }, db: openDb(':memory:'), google: fakeGoogle({ connectedAt: null }).g });
    expect(String((await secure.inject('/api/backup/google/start')).headers['set-cookie'])).toContain('Secure');
  });

  it('callback with matching state but missing or mismatched cookie is 400 and stores nothing', async () => {
    const { app, calls } = setup({ connectedAt: null });
    const start = await app.inject('/api/backup/google/start');
    const state = stateOf(start.headers.location as string);
    const url = `/api/backup/google/callback?code=abc&state=${state}`;
    expect((await app.inject(url)).statusCode).toBe(400);
    expect((await app.inject({ url, headers: { cookie: 'recipes_oauth_state=other' } })).statusCode).toBe(400);
    expect(calls.callback).toEqual([]);
  });

  it('start while connected is 409', async () => {
    const { app } = setup();
    const res = await app.inject('/api/backup/google/start');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Already connected. Disconnect first.' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('callback with a wrong state is 400 and stores nothing', async () => {
    const { app, calls } = setup({ connectedAt: null });
    await app.inject('/api/backup/google/start');
    const res = await app.inject('/api/backup/google/callback?code=abc&state=nope');
    expect(res.statusCode).toBe(400);
    expect((await app.inject('/api/backup/google/callback?code=abc')).statusCode).toBe(400);
    expect(calls.callback).toEqual([]);
  });

  it('state is one-time use', async () => {
    const { app, calls } = setup({ connectedAt: null });
    const start = await app.inject('/api/backup/google/start');
    const state = stateOf(start.headers.location as string);
    const headers = { cookie: cookieOf(start) };
    expect((await app.inject({ url: `/api/backup/google/callback?code=a&state=${state}`, headers })).statusCode).toBe(302);
    expect((await app.inject({ url: `/api/backup/google/callback?code=b&state=${state}`, headers })).statusCode).toBe(400);
    expect(calls.callback).toEqual(['a']);
  });

  it('access_denied redirects back to settings without storing', async () => {
    const { app, calls } = setup({ connectedAt: null });
    const start = await app.inject('/api/backup/google/start');
    const state = stateOf(start.headers.location as string);
    const res = await app.inject({ url: `/api/backup/google/callback?error=access_denied&state=${state}`, headers: { cookie: cookieOf(start) } });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/settings?google=denied');
    expect(calls.callback).toEqual([]);
  });

  it('disconnect clears the account', async () => {
    const { app, calls } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/backup/google/disconnect' });
    expect(res.statusCode).toBe(200);
    expect(calls.disconnects).toBe(1);
    expect((await app.inject('/api/backup/status')).json().connected).toBe(false);
  });
});

describe('backup status and run', () => {
  it('status with no connection: connected false, banner not_connected', async () => {
    const { app } = setup({ connectedAt: null });
    expect((await app.inject('/api/backup/status')).json()).toEqual({
      configured: true, connected: false, account: null, banner: 'not_connected',
      lastRunAt: null, lastSuccessAt: null, lastError: null, lastUploadAt: null, running: false,
    });
  });

  it('connected long ago, never ran -> stale; just connected -> none', async () => {
    const old = setup({ connectedAt: new Date(Date.now() - 40 * 3600_000).toISOString() });
    expect((await old.app.inject('/api/backup/status')).json().banner).toBe('stale');
    const fresh = setup();
    expect((await fresh.app.inject('/api/backup/status')).json().banner).toBe('none');
  });

  it('run when not connected is 409', async () => {
    const { app } = setup({ connectedAt: null });
    const res = await app.inject({ method: 'POST', url: '/api/backup/run' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Google Drive is not connected' });
  });

  it('run with a fake drive records success and the banner is none', async () => {
    const drive = new FakeDrive();
    const { app } = setup({ connectedAt: new Date(Date.now() - 40 * 3600_000).toISOString() }, async () => drive);
    const res = await app.inject({ method: 'POST', url: '/api/backup/run' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, uploadedImages: 0 });
    const st = (await app.inject('/api/backup/status')).json();
    expect(st.banner).toBe('none');
    expect(st.lastSuccessAt).not.toBeNull();
    expect(drive.uploadCount).toBe(2);
  });

  it('POST /api/backup/run is forced: an explicit click uploads even when nothing changed', async () => {
    const drive = new FakeDrive();
    const { app } = setup({}, async () => drive);
    expect((await app.inject({ method: 'POST', url: '/api/backup/run' })).json()).toMatchObject({ ok: true });
    const before = drive.uploadCount;
    const second = (await app.inject({ method: 'POST', url: '/api/backup/run' })).json();
    expect(second.skipped).toBeUndefined();
    expect(drive.uploadCount - before).toBe(2);
    const st = (await app.inject('/api/backup/status')).json();
    expect(st.lastUploadAt).not.toBeNull();
  });

  it('the unforced service path skips unchanged data; runNow({force:true}) uploads', async () => {
    const drive = new FakeDrive();
    const { app } = setup({}, async () => drive);
    await app.backup.runNow();
    const n = drive.uploadCount;
    const skipped = await app.backup.runNow();
    expect(skipped).toMatchObject({ status: 'done', result: { ok: true, skipped: true } });
    expect(drive.uploadCount).toBe(n);
    const forced = await app.backup.runNow({ force: true });
    expect(forced).toMatchObject({ status: 'done', result: { ok: true } });
    expect((forced as any).result.skipped).toBeUndefined();
    expect(drive.uploadCount).toBe(n + 2);
  });

  it('invalid_grant from the factory records failed', async () => {
    const { app } = setup({}, async () => { throw Object.assign(new Error('x'), { response: { data: { error: 'invalid_grant' } } }); });
    const res = await app.inject({ method: 'POST', url: '/api/backup/run' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: false, error: 'Google Drive authorisation failed - reconnect Drive' });
    const st = (await app.inject('/api/backup/status')).json();
    expect(st.banner).toBe('failed');
    expect(st.lastError).toMatch(/reconnect Drive/);
  });

  it('invalid_grant from drive calls records failed', async () => {
    const drive = new FakeDrive();
    drive.failWith({ code: 401 });
    const { app } = setup({}, async () => drive);
    expect((await app.inject({ method: 'POST', url: '/api/backup/run' })).json().ok).toBe(false);
    expect((await app.inject('/api/backup/status')).json().banner).toBe('failed');
  });

  it('a concurrent run is 409 and the lock is released afterwards', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const drive = new FakeDrive();
    const { app } = setup({}, async () => { await gate; return drive; });
    const first = app.inject({ method: 'POST', url: '/api/backup/run' });
    await new Promise((r) => setTimeout(r, 20));
    expect((await app.inject('/api/backup/status')).json().running).toBe(true);
    const second = await app.inject({ method: 'POST', url: '/api/backup/run' });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: 'A backup is already running' });
    expect((await app.backup.runNow()).status).toBe('busy'); // scheduled path is skipped too
    release();
    expect((await first).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/backup/run' })).statusCode).toBe(200);
  });

  it('a hung drive times out as failed, frees the lock, and the abandoned run cannot clobber newer state', async () => {
    let unhang!: () => void;
    const gate = new Promise<void>((r) => (unhang = r));
    const hung: any = {
      ensureFolder: async () => { await gate; throw new Error('late failure'); },
      list: async () => [], upload: async () => 'x', remove: async () => {},
    };
    const good = new FakeDrive();
    let n = 0;
    let runs = 0;
    const g = fakeGoogle();
    const app = buildApp({
      config: { ...loadConfig({}), dataDir: mkdtempSync(path.join(tmpdir(), 'rt-')) }, db: openDb(':memory:'), google: g.g,
      backupDeadlineMs: () => (runs++ === 0 ? 50 : 60_000), driveFactory: async () => (n++ === 0 ? hung : good),
    });
    const t = await app.inject({ method: 'POST', url: '/api/backup/run' });
    expect(t.statusCode).toBe(200);
    expect(t.json()).toEqual({ ok: false, error: 'Backup timed out' });
    expect((await app.inject('/api/backup/status')).json()).toMatchObject({ banner: 'failed', lastError: 'Backup timed out', running: false });
    const again = await app.inject({ method: 'POST', url: '/api/backup/run' });
    expect(again.statusCode).toBe(200);
    expect(again.json().ok).toBe(true);
    unhang(); // abandoned run now fails late
    // Wait until the abandoned run has fully settled (including its tmp cleanup and its guarded write).
    await app.backup.whenIdle();
    const st = (await app.inject('/api/backup/status')).json();
    expect(st.lastError).toBeNull();
    expect(st.banner).toBe('none');
  });

  it('never writes the token file into anything uploaded (dataDir root is not scanned)', async () => {
    const drive = new FakeDrive();
    const { app, dataDir } = setup({}, async () => drive);
    await app.inject({ method: 'POST', url: '/api/backup/run' });
    const root = drive.folderId('Recipes backup')!;
    const names = [...drive.files(drive.folderId('snapshots', root)!), ...drive.files(drive.folderId('images', root)!)].map((f) => f.name);
    expect(names.every((n) => /^recipes-.*\.(sqlite|json)$/.test(n))).toBe(true);
  });
});

describe('status when the Google client is not configured', () => {
  it('treats a leftover token as not connected so the banner shows immediately', async () => {
    const { app } = setup({ configured: false }); // fake still reports an account, like a token file left on disk
    const body = (await app.inject('/api/backup/status')).json();
    expect(body).toMatchObject({ configured: false, connected: false, account: null, banner: 'not_connected' });
  });
});
