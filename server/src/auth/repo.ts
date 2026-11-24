import type { Database } from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';

// Absolute, not sliding: a sliding window would write on every request and let a stolen token live forever.
export const SESSION_TTL_MS = 90 * 24 * 3600 * 1000;
const LAST_SEEN_INTERVAL_MS = 24 * 3600 * 1000;

export type AllowedEmail = { email: string; addedAt: string };

export type AuthRepo = {
  listAllowed(): AllowedEmail[];
  isAllowed(email: string): boolean;
  addAllowed(email: string, now: Date): void;
  removeAllowed(email: string): void;
  createSession(email: string, now: Date): string;
  sessionEmail(token: string, now: Date): string | null;
  deleteSession(token: string): void;
  pruneSessions(now: Date): number;
};

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

// The database is backed up off-box, so only the hash of a token may ever be stored.
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function createAuthRepo(db: Database): AuthRepo {
  const list = db.prepare('SELECT email, added_at AS addedAt FROM allowed_emails ORDER BY email');
  const allowedStmt = db.prepare('SELECT 1 FROM allowed_emails WHERE email = ?');
  const insertAllowed = db.prepare('INSERT OR IGNORE INTO allowed_emails (email, added_at) VALUES (?, ?)');
  const deleteAllowed = db.prepare('DELETE FROM allowed_emails WHERE email = ?');
  const deleteSessionsFor = db.prepare('DELETE FROM sessions WHERE email = ?');
  const insertSession = db.prepare(
    'INSERT INTO sessions (token_hash, email, created_at, last_seen_at) VALUES (?, ?, ?, ?)',
  );
  const findSession = db.prepare('SELECT email, created_at, last_seen_at FROM sessions WHERE token_hash = ?');
  const touchSession = db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?');
  const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const prune = db.prepare('DELETE FROM sessions WHERE created_at <= ?');

  const remove = db.transaction((email: string) => {
    deleteSessionsFor.run(email);
    deleteAllowed.run(email);
  });

  return {
    listAllowed: () => list.all() as AllowedEmail[],
    isAllowed: (email) => allowedStmt.get(normaliseEmail(email)) !== undefined,
    addAllowed(email, now) {
      insertAllowed.run(normaliseEmail(email), now.toISOString());
    },
    removeAllowed(email) {
      remove(normaliseEmail(email));
    },
    createSession(email, now) {
      const token = randomBytes(32).toString('hex');
      const iso = now.toISOString();
      insertSession.run(hashToken(token), normaliseEmail(email), iso, iso);
      return token;
    },
    sessionEmail(token, now) {
      const hash = hashToken(token);
      const row = findSession.get(hash) as { email: string; created_at: string; last_seen_at: string } | undefined;
      if (!row) return null;
      const t = now.getTime();
      // A damaged created_at parses as NaN, and every comparison against NaN is false: without this the
      // row would read as not expired and the session would never die.
      const createdAt = Date.parse(row.created_at);
      if (!Number.isFinite(createdAt) || t - createdAt >= SESSION_TTL_MS) return null;
      if (t - Date.parse(row.last_seen_at) > LAST_SEEN_INTERVAL_MS) touchSession.run(now.toISOString(), hash);
      return row.email;
    },
    deleteSession(token) {
      deleteSessionStmt.run(hashToken(token));
    },
    pruneSessions(now) {
      return prune.run(new Date(now.getTime() - SESSION_TTL_MS).toISOString()).changes;
    },
  };
}
