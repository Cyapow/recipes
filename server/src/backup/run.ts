import type { Database } from 'better-sqlite3';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IMAGE_ID_RE } from '../images/store.js';
import { createRecipeRepo } from '../recipes/repo.js';
import type { DriveClient } from './drive.js';
import { computeFingerprint } from './fingerprint.js';
import { getBackupFingerprint, recordBackup } from './status.js';

export type BackupResult = { ok: true; uploadedImages: number; snapshot: string; skipped?: true } | { ok: false; error: string };

/** Only content-hash originals and their thumbs are backed up (never .tmp-*, dotfiles, etc.). */
export function isBackupImageName(name: string): boolean {
  return IMAGE_ID_RE.test(name) || (name.startsWith('thumb-') && IMAGE_ID_RE.test(name.slice(6)));
}

/** Sorted names of the backup-eligible image files in <dataDir>/images (missing dir = none). */
export async function listBackupImageNames(dataDir: string): Promise<string[]> {
  const entries = await readdir(path.join(dataDir, 'images'), { withFileTypes: true }).catch((e) => {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  });
  return entries.filter((e) => e.isFile() && isBackupImageName(e.name)).map((e) => e.name).sort();
}

const SNAPSHOT_RE = /^recipes-(\d{8}-\d{6})\.(sqlite|json)$/;
const CONCURRENCY = 3;

export function snapshotStamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

const SCRUBBERS: RegExp[] = [/https?:\/\/\S+/g, /ya29\.[\w-]+/g, /1\/\/[\w-]+/g, /Bearer\s+\S+/g];

function isAuthError(e: unknown): boolean {
  const err = e as {
    code?: unknown;
    message?: unknown;
    response?: { status?: unknown; data?: { error?: unknown } };
  } | null;
  if (!err || typeof err !== 'object') return false;
  return (
    err.code === 401 ||
    err.code === '401' ||
    err.code === 'invalid_grant' ||
    err.response?.status === 401 ||
    err.response?.data?.error === 'invalid_grant' ||
    /invalid_grant/.test(String(err.message))
  );
}

/** Message safe to store and show: auth failures are normalised, URLs and tokens removed, 200 chars max. */
export function describeError(e: unknown): string {
  if (isAuthError(e)) return 'Google Drive authorisation failed - reconnect Drive';
  const err = e as { message?: unknown } | null;
  let msg = err && typeof err.message === 'string' ? err.message : String(e);
  for (const re of SCRUBBERS) msg = msg.replace(re, '[removed]');
  return msg.slice(0, 200) || 'Backup failed';
}

export async function runBackup(deps: {
  db: Database;
  dataDir: string;
  drive: DriveClient;
  now?: () => Date;
  keep?: number;
  tmpRoot?: string;
  /** Checked just before recording; false means this run was abandoned and must not touch status. */
  shouldRecord?: () => boolean;
  /** Always do a full backup, even if nothing changed since the last upload. */
  force?: boolean;
}): Promise<BackupResult> {
  const now = deps.now ?? (() => new Date());
  const keep = deps.keep ?? 14;
  let result: BackupResult;
  let tmp: string | undefined;
  let fingerprint: string | undefined;
  try {
    const started = now();
    run: {
      // Computed first: if recipes change while this run is in progress, the stored value is the older one
      // and the next run backs up again.
      fingerprint = await computeFingerprint(deps.db, deps.dataDir);
      const skip = deps.force ? null : await checkUpToDate(deps, fingerprint);
      if (skip) {
        result = { ok: true, skipped: true, uploadedImages: 0, snapshot: skip };
        break run;
      }
      const stamp = snapshotStamp(started);
      const base = `recipes-${stamp}`;
      tmp = await mkdtemp(path.join(deps.tmpRoot ?? os.tmpdir(), 'recipes-backup-'));
      const sqliteFile = path.join(tmp, `${base}.sqlite`);
      const jsonFile = path.join(tmp, `${base}.json`);
      await deps.db.backup(sqliteFile);
      const repo = createRecipeRepo(deps.db);
      const recipes = repo.list({}).map((s) => repo.get(s.id)!);
      await writeFile(jsonFile, JSON.stringify({ exportedAt: started.toISOString(), recipes }, null, 2));

      const root = await deps.drive.ensureFolder('Recipes backup');
      const snapshotsId = await deps.drive.ensureFolder('snapshots', root);
      const imagesId = await deps.drive.ensureFolder('images', root);

      await deps.drive.upload({ folderId: snapshotsId, name: `${base}.sqlite`, filePath: sqliteFile });
      await deps.drive.upload({ folderId: snapshotsId, name: `${base}.json`, filePath: jsonFile });

      const imagesDir = path.join(deps.dataDir, 'images');
      const entries = await readdir(imagesDir, { withFileTypes: true }).catch((e) => {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw e;
      });
      const have = new Set((await deps.drive.list(imagesId)).map((f) => f.name));
      const missing = entries.filter((e) => e.isFile() && isBackupImageName(e.name) && !have.has(e.name)).map((e) => e.name);
      let next = 0;
      let aborted = false;
      const worker = async () => {
        while (!aborted && next < missing.length) {
          const name = missing[next++];
          try {
            await deps.drive.upload({ folderId: imagesId, name, filePath: path.join(imagesDir, name) });
          } catch (e) {
            aborted = true; // no worker starts another upload
            throw e;
          }
        }
      };
      // Wait for every worker so nothing is in flight once runBackup resolves.
      const settled = await Promise.allSettled(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker));
      const failed = settled.find((r) => r.status === 'rejected');
      if (failed) throw (failed as PromiseRejectedResult).reason;

      await applyRetention(deps.drive, snapshotsId, keep, stamp);
      result = { ok: true, uploadedImages: missing.length, snapshot: base };
    }
  } catch (e) {
    result = { ok: false, error: describeError(e) };
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  if (deps.shouldRecord && !deps.shouldRecord()) return result;
  try {
    recordBackup(deps.db, result, now(), fingerprint);
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
  return result;
}

/**
 * Returns the newest existing snapshot base name when the last upload already covers the current data
 * and Drive still holds everything (a snapshot pair and every local image); null means "do a full backup".
 * Drive errors propagate so a revoked token or dead connection still fails the run.
 */
async function checkUpToDate(
  deps: { db: Database; dataDir: string; drive: DriveClient },
  fingerprint: string,
): Promise<string | null> {
  if (getBackupFingerprint(deps.db) !== fingerprint) return null;
  const root = await deps.drive.ensureFolder('Recipes backup');
  const snapshotsId = await deps.drive.ensureFolder('snapshots', root);
  const imagesId = await deps.drive.ensureFolder('images', root);
  const kinds = new Map<string, Set<string>>();
  for (const f of await deps.drive.list(snapshotsId)) {
    const m = SNAPSHOT_RE.exec(f.name);
    if (m) kinds.set(m[1], (kinds.get(m[1]) ?? new Set()).add(m[2]));
  }
  const stamps = [...kinds.entries()].filter(([, k]) => k.has('sqlite') && k.has('json')).map(([s]) => s).sort();
  if (stamps.length === 0) return null;
  const have = new Set((await deps.drive.list(imagesId)).map((f) => f.name));
  for (const name of await listBackupImageNames(deps.dataDir)) if (!have.has(name)) return null;
  return `recipes-${stamps[stamps.length - 1]}`;
}

async function applyRetention(drive: DriveClient, folderId: string, keep: number, currentStamp: string): Promise<void> {
  const pairs = new Map<string, string[]>();
  for (const f of await drive.list(folderId)) {
    const m = SNAPSHOT_RE.exec(f.name);
    if (!m) continue; // unrecognised: leave alone
    pairs.set(m[1], [...(pairs.get(m[1]) ?? []), f.id]);
  }
  const stamps = [...pairs.keys()].sort().reverse(); // timestamps sort lexicographically
  const doomed = stamps.slice(Math.max(keep, 1)).filter((s) => s !== currentStamp);
  for (const s of doomed) for (const id of pairs.get(s)!) await drive.remove(id);
}
