/**
 * Restore a downloaded Drive backup into a data directory.
 *
 *   npm run restore -- <backupDir> [--data-dir <dir>] [--force] [--snapshot <recipes-YYYYMMDD-HHmmss.sqlite>]
 *
 * STOP THE APP FIRST: the SQLite file is replaced underneath whatever has it open.
 * Nothing in the data dir changes until the snapshot has passed validation, and
 * an existing recipes.sqlite is only ever moved aside (never deleted).
 */
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { snapshotStamp } from '../src/backup/run.js';
import { loadConfig } from '../src/config.js';
import { latestSchemaVersion } from '../src/db.js';
import { IMAGE_ID_RE } from '../src/images/store.js';

export class RestoreError extends Error {}

export type RestoreOptions = {
  /** Replace an existing recipes.sqlite (it is moved aside, not deleted). */
  force?: boolean;
  /** Restore this exact snapshot file name instead of the newest. */
  snapshot?: string;
  /** Test hook: the migrations directory that defines "this build's" schema version. */
  migrationsDir?: string;
  now?: () => Date;
  /** Test seam: replaces fs.rename for the database swap so failures can be injected. */
  rename?: (from: string, to: string) => Promise<void>;
};

export type RestoreResult = {
  snapshot: string;
  recipes: number;
  imagesCopied: number;
  imagesSkipped: number;
  /** Recipes whose image_ids reference files not present in the data dir after restore. */
  recipesWithMissingImages: number;
  /** Where the previous recipes.sqlite went, when --force replaced one. */
  movedExisting?: string;
};

const SNAPSHOT_RE = /^recipes-(\d{8}-\d{6})\.sqlite$/;
const WRAPPER = 'Recipes backup';
const isImageName = (n: string) => IMAGE_ID_RE.test(n) || (n.startsWith('thumb-') && IMAGE_ID_RE.test(n.slice(6)));

async function regularFiles(dir: string): Promise<string[]> {
  try {
    // Dirent.isFile() is false for symlinks, so links are never followed.
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return [];
    throw e;
  }
}

const exists = (p: string) => lstat(p).then(() => true, () => false);

type Located = { snapshotsDir: string; root: string; names: string[] };

/** Finds the directory holding recipes-*.sqlite: <dir>[/Recipes backup][/snapshots] or flat. */
async function locate(dir: string): Promise<Located> {
  for (const root of [dir, path.join(dir, WRAPPER)]) {
    for (const snapshotsDir of [path.join(root, 'snapshots'), root]) {
      const names = (await regularFiles(snapshotsDir)).filter((n) => SNAPSHOT_RE.test(n));
      if (names.length) return { root, snapshotsDir, names };
    }
  }
  throw new RestoreError(`No snapshot (recipes-YYYYMMDD-HHmmss.sqlite) found in ${dir}`);
}

type Checked = { recipes: number; imageIds: string[][] };

/** Validates a COPY of the snapshot (so a read-only source and WAL sidecars are no problem). */
function check(file: string, migrationsDir: string | undefined): Checked {
  const db = new Database(file);
  try {
    const integrity = db.pragma('integrity_check') as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
      throw new RestoreError(`integrity_check failed: ${integrity.map((r) => r.integrity_check).slice(0, 3).join('; ')}`);
    }
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'recipes'").get();
    if (!has) throw new RestoreError('database has no recipes table');
    const version = db.pragma('user_version', { simple: true }) as number;
    const latest = latestSchemaVersion(migrationsDir);
    if (version > latest) {
      throw new RestoreError(
        `schema version ${version} is newer than this app supports (${latest}); upgrade the app before restoring it`,
      );
    }
    const rows = db.prepare('SELECT image_ids_json FROM recipes').all() as { image_ids_json: string }[];
    const imageIds = rows.map((r) => {
      try {
        const v = JSON.parse(r.image_ids_json);
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      } catch {
        throw new RestoreError('a recipe has unreadable image_ids_json');
      }
    });
    return { recipes: rows.length, imageIds };
  } finally {
    db.close();
  }
}

type Rename = (from: string, to: string) => Promise<void>;

/**
 * Move the existing database aside (sidecars first, main file last) and put `staged` in place.
 * Every rename that succeeded is recorded; on any failure they are undone in reverse order so the
 * data dir ends up as it was. Returns the pre-restore path of the old main file, if there was one.
 */
async function swapIn(staged: string, target: string, dataDir: string, now: Date, rename: Rename): Promise<string | undefined> {
  const done: [string, string][] = [];
  let step = '';
  const mv = async (from: string, to: string, what: string) => {
    step = what;
    await rename(from, to);
    done.push([from, to]);
  };
  try {
    let moved: string | undefined;
    if (await exists(target)) {
      const stamp = snapshotStamp(now);
      let base = path.join(dataDir, `recipes.sqlite.pre-restore-${stamp}`);
      for (let n = 2; await exists(base); n++) base = path.join(dataDir, `recipes.sqlite.pre-restore-${stamp}-${n}`);
      for (const suffix of ['-wal', '-shm', '']) {
        const from = `${target}${suffix}`;
        if (await exists(from)) await mv(from, base + suffix, `moving the existing database aside (${path.basename(from)})`);
      }
      moved = base;
    }
    // Stale sidecars would be replayed onto the restored file by SQLite.
    await rm(`${target}-wal`, { force: true });
    await rm(`${target}-shm`, { force: true });
    await mv(staged, target, 'installing the restored database');
    return moved;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const failures: string[] = [];
    for (const [from, to] of [...done].reverse()) {
      try {
        await rename(to, from);
      } catch {
        failures.push(to);
      }
    }
    if (failures.length) {
      throw new RestoreError(
        `Restore failed while ${step}: ${reason}. Rollback failed too; put these files back by hand (drop the ".pre-restore-..." part of the name): ${failures.join(', ')}`,
      );
    }
    throw new RestoreError(`Restore failed while ${step}: ${reason}. The original files were put back; nothing was changed.`);
  }
}

export async function restoreFromDirectory(dir: string, dataDir: string, opts: RestoreOptions = {}): Promise<RestoreResult> {
  const st = await lstat(dir).catch(() => undefined);
  if (!st?.isDirectory()) throw new RestoreError(`${dir} is not a directory`);
  const target = path.join(dataDir, 'recipes.sqlite');
  // Cheap refusal first: nothing is read or created if this is going to fail.
  const hadExisting = await exists(target);
  if (hadExisting && !opts.force) {
    throw new RestoreError(`${target} already exists; refusing to overwrite. Use --force to move it aside and restore.`);
  }

  const { root, snapshotsDir, names } = await locate(dir);
  let chosen: string;
  if (opts.snapshot) {
    if (path.basename(opts.snapshot) !== opts.snapshot || !names.includes(opts.snapshot)) {
      throw new RestoreError(`Snapshot ${opts.snapshot} not found. Available: ${[...names].sort().join(', ')}`);
    }
    chosen = opts.snapshot;
  } else {
    chosen = [...names].sort((a, b) => SNAPSHOT_RE.exec(a)![1].localeCompare(SNAPSHOT_RE.exec(b)![1])).pop()!;
  }

  // 1. Validate a private copy outside the data dir.
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'recipes-restore-'));
  let checked: Checked;
  const validated = path.join(scratch, chosen);
  try {
    await copyFile(path.join(snapshotsDir, chosen), validated);
    try {
      checked = check(validated, opts.migrationsDir);
    } catch (e) {
      const why = e instanceof RestoreError ? e.message : `not a valid SQLite database (${(e as Error).message})`;
      const others = names.filter((n) => n !== chosen);
      throw new RestoreError(
        `Snapshot ${chosen} failed validation: ${why}.` +
          (others.length ? ` Not falling back to an older snapshot; pick one explicitly with --snapshot <file> (available: ${others.sort().join(', ')}).` : ''),
      );
    }

    // 2. Stage in the data dir (same filesystem as the final rename).
    await mkdir(dataDir, { recursive: true });
    const staged = path.join(dataDir, `.restore-${randomBytes(6).toString('hex')}.tmp`);
    const imagesDir = path.join(dataDir, 'images');
    let imagesCopied = 0;
    let imagesSkipped = 0;
    try {
      await copyFile(validated, staged);

      // 3. Images (additive, atomic per file; same content-hash name means same content).
      await mkdir(imagesDir, { recursive: true });
      const seen = new Set<string>();
      for (const src of new Set([path.join(root, 'images'), snapshotsDir])) {
        for (const name of await regularFiles(src)) {
          if (!isImageName(name) || seen.has(name)) continue;
          seen.add(name);
          const dest = path.join(imagesDir, name);
          if (await exists(dest)) {
            imagesSkipped++;
            continue;
          }
          const tmp = path.join(imagesDir, `.tmp-${randomBytes(6).toString('hex')}`);
          try {
            await copyFile(path.join(src, name), tmp);
            await rename(tmp, dest);
          } catch (e) {
            await rm(tmp, { force: true });
            throw e;
          }
          imagesCopied++;
        }
      }

      // 4. Swap the database in. The old one is moved, never deleted; failures roll back.
      const movedExisting = await swapIn(staged, target, dataDir, opts.now?.() ?? new Date(), opts.rename ?? rename);

      let missing = 0;
      for (const ids of checked.imageIds) {
        if (ids.some((id) => !(IMAGE_ID_RE.test(id) && existsSync(path.join(imagesDir, id))))) missing++;
      }
      return {
        snapshot: chosen,
        recipes: checked.recipes,
        imagesCopied,
        imagesSkipped,
        recipesWithMissingImages: missing,
        ...(movedExisting ? { movedExisting } : {}),
      };
    } finally {
      await rm(staged, { force: true });
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  let force = false;
  let dataDir: string | undefined;
  let snapshot: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') force = true;
    else if (a === '--data-dir' || a === '--snapshot') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new RestoreError(`${a} needs a value`);
      if (a === '--data-dir') dataDir = v;
      else snapshot = v;
    } else if (a.startsWith('--')) throw new RestoreError(`Unknown option ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 1) {
    throw new RestoreError('Usage: npm run restore -- <backupDir> [--data-dir <dir>] [--force] [--snapshot <file>]');
  }
  return { dir: positional[0], dataDir: dataDir ?? loadConfig(process.env).dataDir, force, snapshot };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log('NOTE: the Recipes app must be stopped while restoring (docker compose stop recipes).');
  const r = await restoreFromDirectory(args.dir, args.dataDir, { force: args.force, snapshot: args.snapshot });
  console.log(`Restored ${r.recipes} recipe(s) from ${r.snapshot} into ${args.dataDir}`);
  console.log(`Images: ${r.imagesCopied} copied, ${r.imagesSkipped} already present`);
  if (r.movedExisting) console.log(`Moved existing database to ${r.movedExisting}`);
  if (r.recipesWithMissingImages) {
    console.warn(`WARNING: ${r.recipesWithMissingImages} recipe(s) reference images that are missing from the backup.`);
  }
  console.log(
    'Google Drive stays connected if the data volume (and its google-token.json) survived. Otherwise, start the app and reconnect Drive in Settings.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`Restore failed: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
