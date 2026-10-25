import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import type { GoogleAuth } from './backup/google.js';

function setup() {
  let disconnects = 0;
  const google: GoogleAuth = {
    configured: true,
    authUrl: () => 'https://accounts.google.com/x',
    handleCallback: async () => ({ email: 'a@b.c' }),
    getDriveClient: async () => null,
    async disconnect() { disconnects++; },
    account: async () => null,
  };
  const dataDir = mkdtempSync(path.join(tmpdir(), 'sec-'));
  const app = buildApp({
    config: { ...loadConfig({}), dataDir, publicBaseUrl: 'https://recipes.example.dev' },
    db: openDb(':memory:'),
    google,
  });
  return { app, disconnects: () => disconnects };
}

const multipart = {
  'content-type': 'multipart/form-data; boundary=XX',
};
const body = '--XX\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\nnot-an-image\r\n--XX--\r\n';

describe('same-origin guard', () => {
  it('blocks cross-site Sec-Fetch-Site on disconnect, run and image upload, doing nothing', async () => {
    const { app, disconnects } = setup();
    const h = { 'sec-fetch-site': 'cross-site' };
    for (const site of ['cross-site', 'same-site']) {
      const headers = { 'sec-fetch-site': site };
      const d = await app.inject({ method: 'POST', url: '/api/backup/google/disconnect', headers });
      const r = await app.inject({ method: 'POST', url: '/api/backup/run', headers });
      const i = await app.inject({ method: 'POST', url: '/api/images', headers: { ...h, ...headers, ...multipart }, payload: body });
      for (const res of [d, r, i]) {
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'Cross-site request blocked' });
      }
    }
    expect(disconnects()).toBe(0);
  });

  it('allows same-origin, none and header-less requests', async () => {
    const { app, disconnects } = setup();
    expect((await app.inject({ method: 'POST', url: '/api/backup/google/disconnect', headers: { 'sec-fetch-site': 'same-origin' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/backup/google/disconnect', headers: { 'sec-fetch-site': 'none' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/backup/google/disconnect' })).statusCode).toBe(200);
    const up = await app.inject({ method: 'POST', url: '/api/images', headers: { 'sec-fetch-site': 'same-origin', ...multipart }, payload: body });
    expect(up.statusCode).not.toBe(403);
    expect(disconnects()).toBe(3);
  });

  it('blocks a foreign Origin without Sec-Fetch-Site, allows Host match and publicBaseUrl', async () => {
    const { app } = setup();
    const post = (origin: string, host?: string) =>
      app.inject({ method: 'POST', url: '/api/backup/google/disconnect', headers: { origin, ...(host ? { host } : {}) } });
    expect((await post('https://evil.example')).statusCode).toBe(403);
    expect((await post('null')).statusCode).toBe(403);
    expect((await post('https://recipes.example.dev')).statusCode).toBe(200);
    expect((await post('http://lan.local:3000', 'lan.local:3000')).statusCode).toBe(200);
  });

  it('leaves GET routes alone', async () => {
    const { app } = setup();
    const res = await app.inject({ url: '/api/health', headers: { 'sec-fetch-site': 'cross-site' } });
    expect(res.statusCode).toBe(200);
  });
});
