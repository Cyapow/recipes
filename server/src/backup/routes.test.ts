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
    const cb = await app.inject(`/api/backup/google/callback?code=abc&state=${state}`);
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('/settings');
    expect(calls.callback).toEqual(['abc']);
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
    const state = stateOf((await app.inject('/api/backup/google/start')).headers.location as string);
    expect((await app.inject(`/api/backup/google/callback?code=a&state=${state}`)).statusCode).toBe(302);
    expect((await app.inject(`/api/backup/google/callback?code=b&state=${state}`)).statusCode).toBe(400);
    expect(calls.callback).toEqual(['a']);
  });

  it('access_denied redirects back to settings without storing', async () => {
    const { app, calls } = setup({ connectedAt: null });
    const state = stateOf((await app.inject('/api/backup/google/start')).headers.location as string);
    const res = await app.inject(`/api/backup/google/callback?error=access_denied&state=${state}`);
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
      lastRunAt: null, lastSuccessAt: null, lastError: null, running: false,
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

  it('never writes the token file into anything uploaded (dataDir root is not scanned)', async () => {
    const drive = new FakeDrive();
    const { app, dataDir } = setup({}, async () => drive);
    await app.inject({ method: 'POST', url: '/api/backup/run' });
    const root = drive.folderId('Recipes backup')!;
    const names = [...drive.files(drive.folderId('snapshots', root)!), ...drive.files(drive.folderId('images', root)!)].map((f) => f.name);
    expect(names.every((n) => /^recipes-.*\.(sqlite|json)$/.test(n))).toBe(true);
  });
});
