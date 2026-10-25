import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGoogleAuth } from './google.js';

const cfg = { googleClientId: 'cid', googleClientSecret: 'sec', publicBaseUrl: 'https://recipes.matchapman.dev' };
let file: string;
beforeEach(() => { file = path.join(mkdtempSync(path.join(tmpdir(), 'g-')), 'google-token.json'); });

function fakeClient(tokens: any, email: string | undefined = 'me@x.com') {
  const revoked: string[] = [];
  const client: any = {
    generateAuthUrl: (o: any) => `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ ...o, scope: o.scope.join(' '), redirect_uri: 'https://recipes.matchapman.dev/api/backup/google/callback' })}`,
    getToken: async () => ({ tokens }),
    verifyIdToken: async () => ({ getPayload: () => ({ email }) }),
    revokeToken: async (t: string) => { revoked.push(t); if (t === 'boom') throw new Error('x'); },
    setCredentials() {},
    on() {},
  };
  return { client, revoked };
}

describe('createGoogleAuth', () => {
  it('uses the production redirect URI, offline access and consent prompt', () => {
    const auth = createGoogleAuth(cfg, file);
    const u = new URL(auth.authUrl('st4te'));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('redirect_uri')).toBe('https://recipes.matchapman.dev/api/backup/google/callback');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('prompt')).toBe('consent');
    expect(u.searchParams.get('state')).toBe('st4te');
    expect(u.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/drive.file');
  });

  it('configured reflects client id/secret', () => {
    expect(createGoogleAuth({ publicBaseUrl: 'x' }, file).configured).toBe(false);
    expect(createGoogleAuth(cfg, file).configured).toBe(true);
  });

  it('missing or corrupt token file means not connected', async () => {
    const auth = createGoogleAuth(cfg, file);
    expect(await auth.account()).toBeNull();
    expect(await auth.getDriveClient()).toBeNull();
    writeFileSync(file, '{not json');
    expect(await auth.account()).toBeNull();
    expect(await auth.getDriveClient()).toBeNull();
  });

  it('callback stores tokens 0600 with email and connectedAt', async () => {
    const { client } = fakeClient({ refresh_token: 'r', access_token: 'a', id_token: 'i' });
    const auth = createGoogleAuth(cfg, file, { makeClient: () => client });
    expect(await auth.handleCallback('code')).toEqual({ email: 'me@x.com' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.email).toBe('me@x.com');
    expect(saved.tokens.refresh_token).toBe('r');
    expect(Number.isNaN(Date.parse(saved.connectedAt))).toBe(false);
    expect((await auth.account())?.email).toBe('me@x.com');
    expect(await auth.getDriveClient()).not.toBeNull();
  });

  it('callback without a refresh_token fails and stores nothing', async () => {
    const { client } = fakeClient({ access_token: 'a', id_token: 'i' });
    const auth = createGoogleAuth(cfg, file, { makeClient: () => client });
    await expect(auth.handleCallback('code')).rejects.toThrow(/refresh token/);
    expect(existsSync(file)).toBe(false);
  });

  it('disconnect deletes the file and still succeeds when revoke fails', async () => {
    const { client, revoked } = fakeClient({ refresh_token: 'boom', id_token: 'i' });
    const auth = createGoogleAuth(cfg, file, { makeClient: () => client });
    await auth.handleCallback('code');
    await auth.disconnect();
    expect(existsSync(file)).toBe(false);
    expect(revoked).toEqual(['boom']);
    await auth.disconnect(); // idempotent
  });
});
