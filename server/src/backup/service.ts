import type { Database } from 'better-sqlite3';
import type { DriveClient } from './drive.js';
import { describeError, runBackup, type BackupResult } from './run.js';
import { recordBackup } from './status.js';

export type RunOutcome = { status: 'busy' } | { status: 'not_connected' } | { status: 'done'; result: BackupResult };

/**
 * Single-flight backup runner shared by the nightly schedule and POST /api/backup/run.
 * A second call while one is running returns 'busy' immediately.
 */
export function createBackupService(deps: {
  db: Database;
  dataDir: string;
  getDrive: () => Promise<DriveClient | null>;
  now?: () => Date;
}) {
  let running = false;
  return {
    isRunning: () => running,
    async runNow(): Promise<RunOutcome> {
      if (running) return { status: 'busy' };
      running = true;
      try {
        let drive: DriveClient | null;
        try {
          drive = await deps.getDrive();
        } catch (e) {
          const result: BackupResult = { ok: false, error: describeError(e) };
          recordBackup(deps.db, result, (deps.now ?? (() => new Date()))());
          return { status: 'done', result };
        }
        if (!drive) return { status: 'not_connected' };
        const result = await runBackup({ db: deps.db, dataDir: deps.dataDir, drive, now: deps.now });
        return { status: 'done', result };
      } finally {
        running = false;
      }
    },
  };
}
export type BackupService = ReturnType<typeof createBackupService>;
