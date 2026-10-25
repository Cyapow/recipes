import type { Database } from 'better-sqlite3';
import type { DriveClient } from './drive.js';
import { describeError, runBackup, type BackupResult } from './run.js';
import { recordBackup } from './status.js';

export type RunOutcome = { status: 'busy' } | { status: 'not_connected' } | { status: 'done'; result: BackupResult };

export const DEFAULT_RUN_DEADLINE_MS = 2 * 3600 * 1000;

/**
 * Single-flight backup runner shared by the nightly schedule and POST /api/backup/run.
 * A second call while one is running returns 'busy' immediately. A run that exceeds the deadline is
 * abandoned: the lock is released, 'Backup timed out' is recorded, and the late run can never record
 * status or release a lock held by a newer run (each run has a token).
 */
export function createBackupService(deps: {
  db: Database;
  dataDir: string;
  getDrive: () => Promise<DriveClient | null>;
  now?: () => Date;
  deadlineMs?: number;
}) {
  const now = deps.now ?? (() => new Date());
  let current = 0; // token of the run holding the lock; 0 = none
  let seq = 0;
  return {
    isRunning: () => current !== 0,
    /** `force` skips the "nothing changed" shortcut (explicit Back up now); the nightly schedule leaves it off. */
    async runNow(opts: { force?: boolean } = {}): Promise<RunOutcome> {
      if (current !== 0) return { status: 'busy' };
      const id = ++seq;
      current = id;
      const mine = () => current === id;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const work = (async (): Promise<RunOutcome> => {
          let drive: DriveClient | null;
          try {
            drive = await deps.getDrive();
          } catch (e) {
            const result: BackupResult = { ok: false, error: describeError(e) };
            if (mine()) recordBackup(deps.db, result, now());
            return { status: 'done', result };
          }
          if (!drive) return { status: 'not_connected' };
          const result = await runBackup({ db: deps.db, dataDir: deps.dataDir, drive, now: deps.now, shouldRecord: mine, force: opts.force === true });
          return { status: 'done', result };
        })();
        work.catch(() => {}); // an abandoned run's late rejection must not be unhandled
        const deadline = new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), deps.deadlineMs ?? DEFAULT_RUN_DEADLINE_MS);
        });
        const out = await Promise.race([work, deadline]);
        if (out === 'timeout') {
          const result: BackupResult = { ok: false, error: 'Backup timed out' };
          recordBackup(deps.db, result, now());
          return { status: 'done', result };
        }
        return out;
      } finally {
        if (timer) clearTimeout(timer);
        if (current === id) current = 0;
      }
    },
  };
}
export type BackupService = ReturnType<typeof createBackupService>;
