import { randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { OAuth2Client, type Credentials } from 'google-auth-library';
import type { Config } from '../config.js';
import type { DriveClient } from './drive.js';
import { createGoogleDriveClient, type DriveRequest } from './googleDrive.js';

export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'];

export type GoogleAuth = {
  configured: boolean;
  authUrl(state: string): string;
  handleCallback(code: string): Promise<{ email: string }>;
  getDriveClient(): Promise<DriveClient | null>;
  disconnect(): Promise<void>;
  account(): Promise<{ email: string; connectedAt: string } | null>;
};

type TokenFile = { tokens: Credentials; email: string; connectedAt: string };

export function redirectUri(config: Pick<Config, 'publicBaseUrl'>): string {
  return `${config.publicBaseUrl.replace(/\/+$/, '')}/api/backup/google/callback`;
}

async function readTokenFile(file: string): Promise<TokenFile | null> {
  try {
    const t = JSON.parse(await readFile(file, 'utf8')) as Partial<TokenFile>;
    if (!t || typeof t !== 'object' || !t.tokens || typeof t.tokens !== 'object' || typeof t.email !== 'string') return null;
    return { tokens: t.tokens, email: t.email, connectedAt: typeof t.connectedAt === 'string' ? t.connectedAt : '' };
  } catch {
    return null; // missing or corrupt: not connected
  }
}

/** Atomic (temp + rename), owner-only. Lives outside the SQLite DB so it is never backed up. */
async function writeTokenFile(file: string, t: TokenFile): Promise<void> {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(t), { mode: 0o600 });
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

export function createGoogleAuth(
  config: Pick<Config, 'googleClientId' | 'googleClientSecret' | 'publicBaseUrl'>,
  tokenFile: string,
  deps: { makeClient?: () => OAuth2Client } = {},
): GoogleAuth {
  const configured = Boolean(config.googleClientId && config.googleClientSecret);
  const makeClient = deps.makeClient ?? (() => new OAuth2Client(config.googleClientId, config.googleClientSecret, redirectUri(config)));

  return {
    configured,

    authUrl(state) {
      return makeClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: GOOGLE_SCOPES, state });
    },

    async handleCallback(code) {
      const client = makeClient();
      const { tokens } = await client.getToken(code);
      if (!tokens.refresh_token) {
        throw new Error(
          'Google did not return a refresh token, so nightly backups could not keep working. ' +
            'Remove this app at myaccount.google.com/permissions and connect again.',
        );
      }
      if (!tokens.id_token) throw new Error('Google did not return an identity token');
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.googleClientId });
      const email = ticket.getPayload()?.email;
      if (!email) throw new Error('Google did not return an account email');
      await writeTokenFile(tokenFile, { tokens, email, connectedAt: new Date().toISOString() });
      return { email };
    },

    async getDriveClient() {
      const saved = await readTokenFile(tokenFile);
      if (!saved || !configured) return null;
      const client = makeClient();
      client.setCredentials(saved.tokens);
      // Persist refreshed tokens so a rotated refresh token is never lost.
      client.on('tokens', (fresh) => {
        void (async () => {
          const cur = await readTokenFile(tokenFile);
          if (!cur) return; // disconnected meanwhile: do not resurrect the file
          await writeTokenFile(tokenFile, { ...cur, tokens: { ...cur.tokens, ...fresh } });
        })().catch(() => {});
      });
      return createGoogleDriveClient(((o) => client.request(o as any)) as DriveRequest);
    },

    async disconnect() {
      const saved = await readTokenFile(tokenFile);
      await rm(tokenFile, { force: true });
      const token = saved?.tokens.refresh_token ?? saved?.tokens.access_token;
      if (token) {
        try {
          await makeClient().revokeToken(token);
        } catch {
          // best effort: local disconnect already happened
        }
      }
    },

    async account() {
      const saved = await readTokenFile(tokenFile);
      return saved ? { email: saved.email, connectedAt: saved.connectedAt } : null;
    },
  };
}
