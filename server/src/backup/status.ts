import type { Database } from 'better-sqlite3';
import type { BackupResult } from './run.js';

export type BackupStatus = { lastRunAt: string | null; lastSuccessAt: string | null; lastError: string | null };
export type Banner = 'none' | 'not_connected' | 'failed' | 'stale';

const KEYS = { lastRunAt: 'backup.lastRunAt', lastSuccessAt: 'backup.lastSuccessAt', lastError: 'backup.lastError' };
const STALE_MS = 36 * 3600 * 1000;

function set(db: Database, key: string, value: string): void {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
function del(db: Database, key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}
function get(db: Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function recordBackup(db: Database, result: BackupResult, now: Date): void {
  db.transaction(() => {
    set(db, KEYS.lastRunAt, now.toISOString());
    if (result.ok) {
      set(db, KEYS.lastSuccessAt, now.toISOString());
      del(db, KEYS.lastError);
    } else {
      set(db, KEYS.lastError, result.error);
    }
  })();
}

export function getBackupStatus(db: Database): BackupStatus {
  return {
    lastRunAt: get(db, KEYS.lastRunAt),
    lastSuccessAt: get(db, KEYS.lastSuccessAt),
    lastError: get(db, KEYS.lastError),
  };
}

/**
 * Precedence: not_connected > failed > stale > none.
 * failed: lastError set and the last run is newer than the last success (or there was never a success).
 * stale: last success older than 36h; or never succeeded, never failed, and `connectedSince` is over 36h ago.
 * Connected but never succeeded with `connectedSince` null (unknown) is 'stale': fail loud, never hide it.
 */
export type BannerInput = (
  | { connected: false; connectedSince?: Date | null }
  | { connected: true; connectedSince: Date | null } // null = unknown
) &
  BackupStatus;

export function deriveBanner(s: BannerInput, now: Date): Banner {
  if (!s.connected) return 'not_connected';
  if (s.lastError && (!s.lastSuccessAt || !s.lastRunAt || s.lastRunAt > s.lastSuccessAt)) return 'failed';
  if (s.lastSuccessAt) {
    return now.getTime() - new Date(s.lastSuccessAt).getTime() > STALE_MS ? 'stale' : 'none';
  }
  // Never succeeded: unknown connection time fails loud; otherwise give 36h grace.
  if (!s.connectedSince) return 'stale';
  return now.getTime() - s.connectedSince.getTime() > STALE_MS ? 'stale' : 'none';
}
