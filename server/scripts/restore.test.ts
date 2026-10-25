import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rename as realRename } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeDrive } from '../src/backup/fakeDrive.js';
import { runBackup } from '../src/backup/run.js';
import { latestSchemaVersion, openDb } from '../src/db.js';
import { createRecipeRepo } from '../src/recipes/repo.js';
import { createShoppingRepo } from '../src/shopping/repo.js';
import type { RecipeInput } from '../src/recipes/schema.js';
import { restoreFromDirectory } from './restore.js';

const H1 = 'a'.repeat(64) + '.jpg';
const H2 = 'b'.repeat(64) + '.jpg';
const MISSING = 'c'.repeat(64) + '.jpg';
const input = (title: string, imageIds: string[] = []): RecipeInput => ({
  title, description: 'd', origin: 'mine', sourceName: 'Gran', sourceUrl: null, servings: 4,
  prepMinutes: 5, cookMinutes: 10,
  ingredients: [{ group: 'A', quantity: 2, unit: 'g', item: 'salt', note: null }],
  steps: ['stir'], notes: 'n', tags: ['t'], imageIds,
});

let root: string;
let src: string; // live "source" data dir
let backupDir: string; // downloaded backup, Drive layout
let dataDir: string;
let db: ReturnType<typeof openDb>;

const listing = (d: string) => (existsSync(d) ? readdirSync(d).sort() : null);

beforeEach(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), 'restore-test-'));
  src = path.join(root, 'src');
  backupDir = path.join(root, 'backup');
  dataDir = path.join(root, 'data');
  mkdirSync(path.join(src, 'images'), { recursive: true });
  for (const n of [H1, H2, `thumb-${H1}`, `thumb-${H2}`]) writeFileSync(path.join(src, 'images', n), `bytes-${n}`);
  db = openDb(path.join(src, 'recipes.sqlite'));
  const repo = createRecipeRepo(db);
  repo.create(input('Soup', [H1]));
  repo.create(input('Stew', [H1, H2]));
  const drive = new FakeDrive();
  const r = await runBackup({ db, dataDir: src, drive, now: () => new Date(Date.UTC(2026, 0, 2, 3, 0, 0)) });
  expect(r.ok).toBe(true);
  drive.dumpTo(backupDir);
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const snapDir = () => path.join(backupDir, 'Recipes backup', 'snapshots');
const open = () => openDb(path.join(dataDir, 'recipes.sqlite'));

describe('restoreFromDirectory', () => {
  it('clears the backup fingerprint keys so the first run after a restore uploads, keeping the recipes', async () => {
    // Source DB carries backup bookkeeping; take a forced backup of it, then restore that snapshot.
    for (const [k, v] of [['backup.lastFingerprint', 'fp'], ['backup.lastSnapshot', 'recipes-20260101-030000'], ['backup.lastUploadAt', '2026-01-01T03:00:00.000Z'], ['backup.lastRunAt', 'r']]) {
      db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
    }
    const drive = new FakeDrive();
    await runBackup({ db, dataDir: src, drive, now: () => new Date(Date.UTC(2026, 0, 3, 3, 0, 0)), force: true });
    const dir2 = path.join(root, 'backup2');
    drive.dumpTo(dir2);
    await restoreFromDirectory(dir2, dataDir);
    const restored = open();
    const keys = (restored.prepare("SELECT key FROM settings WHERE key LIKE 'backup.%' ORDER BY key").all() as { key: string }[]).map((r) => r.key);
    expect(keys).not.toContain('backup.lastFingerprint');
    expect(keys).not.toContain('backup.lastSnapshot');
    expect(keys).not.toContain('backup.lastUploadAt');
    expect(createRecipeRepo(restored).list({})).toEqual(createRecipeRepo(db).list({}));
    // first run after the restore does a full backup
    const drive2 = new FakeDrive();
    const r = await runBackup({ db: restored, dataDir, drive: drive2 });
    expect(r.ok && r.skipped).toBeFalsy();
    expect(drive2.uploadCount).toBeGreaterThanOrEqual(2);
    restored.close();
  });

  it('round-trips recipes and images (Drive layout nested in "Recipes backup")', async () => {
    const out = await restoreFromDirectory(backupDir, dataDir);
    const restored = open();
    const rr = createRecipeRepo(restored);
    const orig = createRecipeRepo(db);
    expect(rr.list({})).toEqual(orig.list({}));
    for (const s of orig.list({})) expect(rr.get(s.id)).toEqual(orig.get(s.id));
    restored.close();
    expect(listing(path.join(dataDir, 'images'))).toEqual([H1, H2, `thumb-${H1}`, `thumb-${H2}`].sort());
    expect(readFileSync(path.join(dataDir, 'images', `thumb-${H2}`), 'utf8')).toBe(`bytes-thumb-${H2}`);
    expect(out).toMatchObject({ recipes: 2, imagesCopied: 4, imagesSkipped: 0, recipesWithMissingImages: 0 });
    expect(existsSync(path.join(dataDir, 'google-token.json'))).toBe(false);
    expect(readdirSync(dataDir).filter((f) => f.startsWith('.'))).toEqual([]);
  });

  it('accepts the Drive layout without the wrapper folder, and a flat layout', async () => {
    const drive = path.join(root, 'drive-layout');
    cpSync(path.join(backupDir, 'Recipes backup'), drive, { recursive: true });
    await restoreFromDirectory(drive, path.join(root, 'd1'));
    expect(listing(path.join(root, 'd1'))).toContain('recipes.sqlite');

    const flat = path.join(root, 'flat');
    mkdirSync(path.join(flat, 'images'), { recursive: true });
    for (const f of readdirSync(snapDir())) cpSync(path.join(snapDir(), f), path.join(flat, f));
    cpSync(path.join(backupDir, 'Recipes backup', 'images'), path.join(flat, 'images'), { recursive: true });
    const out = await restoreFromDirectory(flat, path.join(root, 'd2'));
    expect(out.recipes).toBe(2);
    expect(out.imagesCopied).toBe(4);

    const alongside = path.join(root, 'alongside');
    mkdirSync(alongside);
    for (const f of readdirSync(snapDir())) cpSync(path.join(snapDir(), f), path.join(alongside, f));
    writeFileSync(path.join(alongside, H1), 'x');
    const out2 = await restoreFromDirectory(alongside, path.join(root, 'd3'));
    expect(out2.imagesCopied).toBe(1);
  });

  it('rejects a second run without force and changes nothing; force moves the old DB aside', async () => {
    await restoreFromDirectory(backupDir, dataDir);
    const dbBytes = readFileSync(path.join(dataDir, 'recipes.sqlite'));
    const before = listing(dataDir);
    await expect(restoreFromDirectory(backupDir, dataDir)).rejects.toThrow(/refusing to overwrite.*--force/);
    expect(listing(dataDir)).toEqual(before);
    expect(readFileSync(path.join(dataDir, 'recipes.sqlite'))).toEqual(dbBytes);

    // stale sidecars from a live DB must not survive the swap
    writeFileSync(path.join(dataDir, 'recipes.sqlite-wal'), 'stale-wal');
    writeFileSync(path.join(dataDir, 'recipes.sqlite-shm'), 'stale-shm');
    const out = await restoreFromDirectory(backupDir, dataDir, { force: true });
    const names = readdirSync(dataDir);
    const moved = names.filter((n) => n.startsWith('recipes.sqlite.pre-restore-'));
    expect(moved.length).toBe(3);
    expect(out.movedExisting).toMatch(/recipes\.sqlite\.pre-restore-/);
    expect(readFileSync(path.join(dataDir, out.movedExisting!.split(path.sep).pop()!))).toEqual(dbBytes);
    expect(names).not.toContain('recipes.sqlite-wal');
    expect(names).not.toContain('recipes.sqlite-shm');
    const restored = open();
    expect(createRecipeRepo(restored).list({}).length).toBe(2);
    restored.close();
  });

  it('is idempotent for images (skips existing)', async () => {
    await restoreFromDirectory(backupDir, dataDir);
    const out = await restoreFromDirectory(backupDir, dataDir, { force: true });
    expect(out).toMatchObject({ imagesCopied: 0, imagesSkipped: 4 });
  });

  it('rejects a corrupt snapshot and leaves dataDir untouched, without falling back to an older one', async () => {
    const good = readdirSync(snapDir()).find((f) => f.endsWith('.sqlite'))!;
    writeFileSync(path.join(snapDir(), 'recipes-20260301-030000.sqlite'), Buffer.from('garbage bytes, not sqlite at all'.repeat(50)));
    mkdirSync(dataDir);
    writeFileSync(path.join(dataDir, 'keep.txt'), 'k');
    await expect(restoreFromDirectory(backupDir, dataDir)).rejects.toThrow(/recipes-20260301-030000\.sqlite.*(not a valid|integrity|failed validation)/s);
    expect(listing(dataDir)).toEqual(['keep.txt']);
    // explicit older snapshot works
    const out = await restoreFromDirectory(backupDir, dataDir, { snapshot: good });
    expect(out.recipes).toBe(2);
    expect(out.snapshot).toBe(good);
  });

  it('does not create dataDir when validation fails', async () => {
    writeFileSync(path.join(snapDir(), 'recipes-20260301-030000.sqlite'), 'nope');
    await expect(restoreFromDirectory(backupDir, dataDir)).rejects.toThrow();
    expect(existsSync(dataDir)).toBe(false);
  });

  it('rejects a snapshot from a newer schema', async () => {
    const f = path.join(snapDir(), readdirSync(snapDir()).find((n) => n.endsWith('.sqlite'))!);
    const d = new Database(f);
    d.pragma(`user_version = ${latestSchemaVersion() + 1}`);
    d.close();
    await expect(restoreFromDirectory(backupDir, dataDir)).rejects.toThrow(/newer/i);
    expect(existsSync(dataDir)).toBe(false);
  });

  it('rejects a database without a recipes table', async () => {
    const f = path.join(snapDir(), 'recipes-20260301-030000.sqlite');
    const d = new Database(f);
    d.exec('CREATE TABLE other (x)');
    d.close();
    await expect(restoreFromDirectory(backupDir, dataDir)).rejects.toThrow(/recipes table/i);
  });

  it('accepts an older schema and openDb migrates it on next start', async () => {
    // Pretend this build ships one more migration than the real one; the backup is then "older".
    const migrations = path.join(root, 'migrations');
    cpSync(new URL('../src/migrations', import.meta.url), migrations, { recursive: true });
    const current = latestSchemaVersion();
    writeFileSync(path.join(migrations, '999_extra.sql'), 'ALTER TABLE recipes ADD COLUMN extra TEXT;');
    expect(latestSchemaVersion(migrations)).toBe(current + 1);
    await restoreFromDirectory(backupDir, dataDir, { migrationsDir: migrations });
    const raw = new Database(path.join(dataDir, 'recipes.sqlite'));
    expect(raw.pragma('user_version', { simple: true })).toBe(current);
    raw.close();
    const migrated = openDb(path.join(dataDir, 'recipes.sqlite'), migrations);
    expect(migrated.pragma('user_version', { simple: true })).toBe(current + 1);
    expect(migrated.prepare('SELECT extra FROM recipes').all()).toHaveLength(2);
    migrated.close();
  });

  it('ignores .tmp-*, non-image files, traversal-looking names and symlinks; counts missing images', async () => {
    const imgs = path.join(backupDir, 'Recipes backup', 'images');
    writeFileSync(path.join(imgs, '.tmp-abc123'), 'x');
    writeFileSync(path.join(imgs, 'notes.txt'), 'x');
    writeFileSync(path.join(imgs, 'thumb-thumb-' + H1), 'x');
    writeFileSync(path.join(imgs, 'A'.repeat(64) + '.jpg'), 'x');
    symlinkSync('/etc/hosts', path.join(imgs, 'd'.repeat(64) + '.jpg'));
    // a recipe referencing an image not in the backup, in the snapshot
    const f = path.join(snapDir(), readdirSync(snapDir()).find((n) => n.endsWith('.sqlite'))!);
    const d = new Database(f);
    d.pragma('journal_mode = DELETE');
    d.prepare('UPDATE recipes SET image_ids_json = ? WHERE title = ?').run(JSON.stringify([H1, MISSING]), 'Soup');
    d.close();
    const out = await restoreFromDirectory(backupDir, dataDir);
    expect(listing(path.join(dataDir, 'images'))).toEqual([H1, H2, `thumb-${H1}`, `thumb-${H2}`].sort());
    expect(out.recipesWithMissingImages).toBe(1);
  });

  it('errors clearly when there is no snapshot', async () => {
    const empty = path.join(root, 'empty');
    mkdirSync(empty);
    await expect(restoreFromDirectory(empty, dataDir)).rejects.toThrow(/no snapshot/i);
    await expect(restoreFromDirectory(path.join(root, 'nope'), dataDir)).rejects.toThrow(/not a directory/i);
  });
});

describe('restore: step photos, legacy steps and shopping rows', () => {
  const snapFile = () => path.join(snapDir(), readdirSync(snapDir()).find((n) => n.endsWith('.sqlite'))!);
  const withSnapshot = (fn: (d: Database.Database) => void) => {
    const d = new Database(snapFile());
    d.pragma('journal_mode = DELETE');
    fn(d);
    d.close();
  };

  it('counts distinct step images missing from the backup (and not the present ones)', async () => {
    const steps = JSON.stringify([
      { text: 'a', imageId: H1, ingredients: [] },
      { text: 'b', imageId: MISSING, ingredients: [] },
      { text: 'c', imageId: MISSING, ingredients: [] },
      { text: 'd', imageId: null, ingredients: [] },
    ]);
    withSnapshot((d) => d.prepare('UPDATE recipes SET steps_json = ? WHERE title = ?').run(steps, 'Soup'));
    const out = await restoreFromDirectory(backupDir, dataDir);
    expect(out.missingStepImages).toBe(1);
    expect(out.recipesWithMissingImages).toBe(0);
  });

  it('restores an old snapshot with legacy string steps; the app reads them as normalised Steps', async () => {
    withSnapshot((d) => d.prepare('UPDATE recipes SET steps_json = ? WHERE title = ?').run('["Boil","Serve"]', 'Soup'));
    const out = await restoreFromDirectory(backupDir, dataDir);
    expect(out.missingStepImages).toBe(0);
    const restored = open();
    const repo = createRecipeRepo(restored);
    const soup = repo.list({}).find((r) => r.title === 'Soup')!;
    expect(repo.get(soup.id)!.steps).toEqual([
      { text: 'Boil', imageId: null, ingredients: [] },
      { text: 'Serve', imageId: null, ingredients: [] },
    ]);
    restored.close();
  });

  it('restores shopping rows intact', async () => {
    const recipe = createRecipeRepo(db).get(createRecipeRepo(db).list({})[0].id)!;
    createShoppingRepo(db).add({ id: recipe.id, title: recipe.title }, recipe.ingredients);
    const before = createShoppingRepo(db).list();
    expect(before.length).toBeGreaterThan(0);
    const drive = new FakeDrive();
    await runBackup({ db, dataDir: src, drive, force: true, now: () => new Date(Date.UTC(2026, 0, 4, 3, 0, 0)) });
    const dir2 = path.join(root, 'backup-shopping');
    drive.dumpTo(dir2);
    await restoreFromDirectory(dir2, dataDir);
    const restored = open();
    expect(createShoppingRepo(restored).list()).toEqual(before);
    restored.close();
  });

  it('restores a snapshot from before the shopping migration and openDb migrates it', async () => {
    withSnapshot((d) => {
      d.exec('DROP TABLE shopping_items');
      d.pragma('user_version = 1');
    });
    await restoreFromDirectory(backupDir, dataDir);
    const raw = new Database(path.join(dataDir, 'recipes.sqlite'));
    expect(raw.prepare("SELECT 1 FROM sqlite_master WHERE name = 'shopping_items'").get()).toBeUndefined();
    raw.close();
    const migrated = open();
    expect(migrated.pragma('user_version', { simple: true })).toBe(latestSchemaVersion());
    expect(createShoppingRepo(migrated).list()).toEqual([]);
    expect(createRecipeRepo(migrated).list({})).toHaveLength(2);
    migrated.close();
  });
});

describe('restore rollback when the swap fails part-way', () => {
  const bytesOf = (d: string) => Object.fromEntries(readdirSync(d).filter((n) => n.startsWith('recipes.sqlite')).map((n) => [n, readFileSync(path.join(d, n), 'utf8')]));
  const seed = async () => {
    await restoreFromDirectory(backupDir, dataDir);
    writeFileSync(path.join(dataDir, 'recipes.sqlite-wal'), 'orig-wal');
    writeFileSync(path.join(dataDir, 'recipes.sqlite-shm'), 'orig-shm');
    return { before: listing(dataDir), bytes: bytesOf(dataDir) };
  };
  const failing = (match: (from: string, to: string) => boolean) => async (from: string, to: string) => {
    if (match(from, to)) throw new Error('injected rename failure');
    return realRename(from, to);
  };
  const mainMove = (_f: string, t: string) => /recipes\.sqlite\.pre-restore-[\d-]+$/.test(t);

  it('restores the original files when moving the main file aside fails after the sidecars moved', async () => {
    const { before, bytes } = await seed();
    await expect(restoreFromDirectory(backupDir, dataDir, { force: true, rename: failing(mainMove) })).rejects.toThrow(/moving the existing database aside.*original files were put back/s);
    expect(listing(dataDir)).toEqual(before);
    expect(bytesOf(dataDir)).toEqual(bytes);
  });

  it('restores the original files when a sidecar move fails', async () => {
    const { before, bytes } = await seed();
    await expect(
      restoreFromDirectory(backupDir, dataDir, { force: true, rename: failing((_f, t) => t.endsWith('-shm') && /pre-restore/.test(t)) }),
    ).rejects.toThrow(/-shm|aside/);
    expect(listing(dataDir)).toEqual(before);
    expect(bytesOf(dataDir)).toEqual(bytes);
  });

  it('restores the original files when installing the restored database fails', async () => {
    const { before, bytes } = await seed();
    await expect(
      restoreFromDirectory(backupDir, dataDir, { force: true, rename: failing((f, t) => f.includes('.restore-') && t.endsWith('recipes.sqlite')) }),
    ).rejects.toThrow(/installing the restored database.*original files were put back/s);
    expect(listing(dataDir)).toEqual(before);
    expect(bytesOf(dataDir)).toEqual(bytes);
  });

  it('names the pre-restore files when the rollback itself fails', async () => {
    await seed();
    const rename = async (f: string, t: string) => {
      if (f.includes('.restore-') && t.endsWith('recipes.sqlite')) throw new Error('injected rename failure');
      if (/pre-restore/.test(f)) throw new Error('injected rollback failure');
      return realRename(f, t);
    };
    await expect(restoreFromDirectory(backupDir, dataDir, { force: true, rename })).rejects.toThrow(
      /Rollback failed.*recipes\.sqlite\.pre-restore-[\d-]+.*recipes\.sqlite\.pre-restore-[\d-]+-wal/s,
    );
  });
});

describe('restore CLI', () => {
  const run = (args: string[]) =>
    execFileSync('npx', ['tsx', 'server/scripts/restore.ts', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  it('restores end-to-end, then refuses without --force with a non-zero exit', () => {
    const out = run([backupDir, '--data-dir', dataDir]);
    expect(out).toMatch(/Restored 2 recipe/);
    expect(out).toMatch(/stop|Reconnect/i);
    console.log(out);
    let err: { status?: number; stderr?: string } = {};
    try {
      run([backupDir, '--data-dir', dataDir]);
    } catch (e) {
      err = e as typeof err;
    }
    expect(err.status).toBe(1);
    expect(err.stderr).toMatch(/--force/);
    expect(run([backupDir, '--data-dir', dataDir, '--force'])).toMatch(/Moved existing database/);
  }, 60_000);
});
