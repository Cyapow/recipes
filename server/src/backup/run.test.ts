import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { createRecipeRepo } from '../recipes/repo.js';
import type { RecipeInput } from '../recipes/schema.js';
import { FakeDrive } from './fakeDrive.js';
import { computeFingerprint } from './fingerprint.js';
import { isBackupImageName, runBackup } from './run.js';
import { deriveBanner, getBackupFingerprint, getBackupSnapshot, getBackupStatus } from './status.js';

const H1 = 'a'.repeat(64) + '.jpg';
const H2 = 'b'.repeat(64) + '.jpg';
const input = (title: string): RecipeInput => ({
  title, description: null, origin: 'mine', sourceName: null, sourceUrl: null, servings: null,
  prepMinutes: null, cookMinutes: null, ingredients: [], steps: ['x'], notes: null, tags: [], imageIds: [],
});

let dir: string;
let db: ReturnType<typeof openDb>;
let drive: FakeDrive;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'bk-test-'));
  mkdirSync(path.join(dir, 'images'));
  db = openDb(path.join(dir, 'recipes.db'));
  const repo = createRecipeRepo(db);
  repo.create(input('Soup'));
  repo.create(input('Stew'));
  for (const n of [H1, H2, `thumb-${H1}`, `thumb-${H2}`]) writeFileSync(path.join(dir, 'images', n), n);
  drive = new FakeDrive();
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const snaps = () => drive.files(drive.folderId('snapshots', drive.folderId('Recipes backup'))!);
const imgs = () => drive.files(drive.folderId('images', drive.folderId('Recipes backup'))!);
const day = (n: number) => () => new Date(Date.UTC(2026, 0, 1 + n, 3, 0, 0));

describe('isBackupImageName', () => {
  it('accepts only hashes and thumbs', () => {
    expect(isBackupImageName(H1)).toBe(true);
    expect(isBackupImageName(`thumb-${H1}`)).toBe(true);
    for (const n of ['.tmp-abc123', '.DS_Store', 'notes.txt', 'thumb-.tmp-x', `x${H1}`, `${H1}.bak`, 'thumb-thumb-' + H1]) {
      expect(isBackupImageName(n)).toBe(false);
    }
  });
});

describe('runBackup', () => {
  it('first run uploads one sqlite, one json and every image; second run uploads no images', async () => {
    const r = await runBackup({ db, dataDir: dir, drive, now: day(0) });
    expect(r).toMatchObject({ ok: true, uploadedImages: 4, snapshot: 'recipes-20260101-030000' });
    expect(snaps().map((f) => f.name).sort()).toEqual(['recipes-20260101-030000.json', 'recipes-20260101-030000.sqlite']);
    expect(imgs().map((f) => f.name).sort()).toEqual([H1, H2, `thumb-${H1}`, `thumb-${H2}`].sort());
    const before = drive.uploadCount;
    const r2 = await runBackup({ db, dataDir: dir, drive, now: day(0), force: true });
    expect(r2).toMatchObject({ ok: true, uploadedImages: 0 });
    expect(drive.uploadCount - before).toBe(2); // only the snapshot pair
  });

  it('ensureFolder is idempotent across runs', async () => {
    await runBackup({ db, dataDir: dir, drive, now: day(0) });
    const n = drive.folderCount();
    await runBackup({ db, dataDir: dir, drive, now: day(1) });
    expect(n).toBe(3);
    expect(drive.folderCount()).toBe(3);
  });

  it('skips .tmp-*, dotfiles, directories and other files', async () => {
    const id = path.join(dir, 'images');
    writeFileSync(path.join(id, '.tmp-deadbeef'), 'x');
    writeFileSync(path.join(id, '.DS_Store'), 'x');
    writeFileSync(path.join(id, 'readme.txt'), 'x');
    mkdirSync(path.join(id, 'c'.repeat(64) + '.jpg'));
    const r = await runBackup({ db, dataDir: dir, drive, now: day(0) });
    expect(r).toMatchObject({ ok: true, uploadedImages: 4 });
    expect(imgs()).toHaveLength(4);
  });

  it('works with no images directory', async () => {
    rmSync(path.join(dir, 'images'), { recursive: true });
    expect(await runBackup({ db, dataDir: dir, drive, now: day(0) })).toMatchObject({ ok: true, uploadedImages: 0 });
  });

  it('uploaded .sqlite opens with the recipes; .json holds full recipes', async () => {
    await runBackup({ db, dataDir: dir, drive, now: day(0) });
    const sq = snaps().find((f) => f.name.endsWith('.sqlite'))!;
    const copy = path.join(dir, 'restored.db');
    writeFileSync(copy, drive.read(sq.id));
    const r = new Database(copy, { readonly: true });
    expect((r.prepare('SELECT title FROM recipes ORDER BY title').all() as { title: string }[]).map((x) => x.title)).toEqual(['Soup', 'Stew']);
    r.close();
    const js = JSON.parse(drive.read(snaps().find((f) => f.name.endsWith('.json'))!.id).toString());
    expect(js.exportedAt).toBe('2026-01-01T03:00:00.000Z');
    expect(js.recipes.map((x: { title: string }) => x.title).sort()).toEqual(['Soup', 'Stew']);
    expect(js.recipes[0].steps).toEqual(['x']);
  });

  it('records success status', async () => {
    await runBackup({ db, dataDir: dir, drive, now: day(0) });
    expect(getBackupStatus(db)).toEqual({
      lastRunAt: '2026-01-01T03:00:00.000Z', lastSuccessAt: '2026-01-01T03:00:00.000Z', lastError: null,
      lastUploadAt: '2026-01-01T03:00:00.000Z',
    });
  });

  it('a drive failing on the 3rd upload gives ok:false and no lastSuccessAt', async () => {
    drive.failOnUpload(3);
    const r = await runBackup({ db, dataDir: dir, drive, now: day(0) });
    expect(r).toEqual({ ok: false, error: 'upload failed' });
    const s = getBackupStatus(db);
    expect(s.lastSuccessAt).toBeNull();
    expect(s.lastError).toBe('upload failed');
    expect(s.lastRunAt).not.toBeNull();
  });

  it('a later successful run continues the interrupted image upload', async () => {
    drive.failOnUpload(3);
    await runBackup({ db, dataDir: dir, drive, now: day(0) });
    const r = await runBackup({ db, dataDir: dir, drive, now: day(1) });
    expect(r.ok).toBe(true);
    expect(imgs()).toHaveLength(4);
  });

  it('an auth error fails the run with a reconnect message', async () => {
    drive.failWith(Object.assign(new Error('invalid_grant'), { code: 401 }));
    const r = await runBackup({ db, dataDir: dir, drive, now: day(0) });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/authori[sz]ation/i) });
    expect(getBackupStatus(db).lastSuccessAt).toBeNull();
    const status = getBackupStatus(db);
    expect(deriveBanner({ connected: true, connectedSince: null, ...status }, day(0)())).toBe('failed');
  });

  it('invalid_grant string code also yields the failed banner', async () => {
    drive.failWith(Object.assign(new Error('x'), { code: 'invalid_grant' }));
    await runBackup({ db, dataDir: dir, drive, now: day(0) });
    expect(deriveBanner({ connected: true, connectedSince: null, ...getBackupStatus(db) }, day(0)())).toBe('failed');
  });

  it('a failure aborts the run: no uploads start or continue after runBackup resolves', async () => {
    for (let i = 0; i < 6; i++) writeFileSync(path.join(dir, 'images', String(i).repeat(64) + '.jpg'), 'x');
    drive.uploadDelayMs = 10;
    drive.failOnUpload(4); // 2 snapshot uploads, then the 2nd image upload
    const r = await runBackup({ db, dataDir: dir, drive, now: day(0) });
    expect(r.ok).toBe(false);
    const count = drive.uploadCount;
    expect(count).toBe(5); // 3 workers started (#3,#4,#5); nothing after the failure
    expect(drive.inFlight).toBe(0);
    await new Promise((res) => setTimeout(res, 60));
    expect(drive.uploadCount).toBe(count);
  });

  it('never exceeds 3 concurrent uploads and uploads everything', async () => {
    for (let i = 0; i < 10; i++) writeFileSync(path.join(dir, 'images', String(i).repeat(64) + '.jpg'), 'x');
    drive.uploadDelayMs = 5;
    const r = await runBackup({ db, dataDir: dir, drive, now: day(0) });
    expect(r).toMatchObject({ ok: true, uploadedImages: 14 });
    expect(drive.maxInFlight).toBeLessThanOrEqual(3);
    expect(drive.maxInFlight).toBeGreaterThan(1);
    expect(imgs()).toHaveLength(14);
  });

  it('keeps 14 pairs after 16 successive days', async () => {
    for (let i = 0; i < 16; i++) expect((await runBackup({ db, dataDir: dir, drive, now: day(i), force: true })).ok).toBe(true);
    const names = snaps().map((f) => f.name);
    expect(names).toHaveLength(28);
    expect(names).not.toContain('recipes-20260101-030000.sqlite');
    expect(names).not.toContain('recipes-20260102-030000.json');
    expect(names).toContain('recipes-20260103-030000.sqlite');
    expect(names).toContain('recipes-20260116-030000.json');
  });

  it('retention: orphans counted/deleted, unknown names left alone, current pair protected', async () => {
    const f = drive.folderId('Recipes backup') ?? (await drive.ensureFolder('Recipes backup'));
    const s = await drive.ensureFolder('snapshots', f);
    const up = (name: string) => {
      const p = path.join(dir, 'x');
      writeFileSync(p, name);
      return drive.upload({ folderId: s, name, filePath: p });
    };
    await up('recipes-20251201-030000.sqlite'); // orphan, oldest
    await up('recipes-20251202-030000.sqlite');
    await up('recipes-20251202-030000.json');
    await up('notes.txt');
    // now() earlier than existing snapshots: current pair must still survive
    await runBackup({ db, dataDir: dir, drive, now: day(0), keep: 1 });
    const names = snaps().map((x) => x.name).sort();
    expect(names).toEqual(['notes.txt', 'recipes-20260101-030000.json', 'recipes-20260101-030000.sqlite']);
  });

  it('failed run does not delete older snapshots', async () => {
    for (let i = 0; i < 3; i++) await runBackup({ db, dataDir: dir, drive, now: day(i), keep: 3, force: true });
    expect(snaps()).toHaveLength(6);
    writeFileSync(path.join(dir, 'images', 'd'.repeat(64) + '.jpg'), 'new');
    drive.failOnUpload(drive.uploadCount + 3); // snapshot x2 ok, image fails
    const r = await runBackup({ db, dataDir: dir, drive, now: day(3), keep: 3, force: true });
    expect(r.ok).toBe(false);
    const names = snaps().map((x) => x.name);
    expect(names).toContain('recipes-20260101-030000.sqlite');
    expect(getBackupStatus(db).lastSuccessAt).toBe(day(2)().toISOString());
  });

  it('cleans up its temp dir on success and failure', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'bk-root-'));
    try {
      await runBackup({ db, dataDir: dir, drive, now: day(0), tmpRoot: root });
      expect(readdirSync(root)).toEqual([]);
      drive.failOnUpload(drive.uploadCount + 1);
      expect((await runBackup({ db, dataDir: dir, drive, now: day(1), tmpRoot: root, force: true })).ok).toBe(false);
      expect(readdirSync(root)).toEqual([]);
      expect(existsSync(root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('skip when unchanged', () => {
  const run = (n: number, extra: { force?: boolean } = {}) => runBackup({ db, dataDir: dir, drive, now: day(n), ...extra });
  const repo = () => createRecipeRepo(db);

  it('first run uploads and stores the fingerprint and lastUploadAt', async () => {
    const r = await run(0);
    expect(r).toMatchObject({ ok: true, uploadedImages: 4 });
    expect((r as { skipped?: true }).skipped).toBeUndefined();
    expect(getBackupFingerprint(db)).toBe(await computeFingerprint(db, dir));
    expect(getBackupStatus(db).lastUploadAt).toBe(day(0)().toISOString());
  });

  it('second unchanged run skips: no uploads, no deletes, success advances, lastUploadAt does not', async () => {
    await run(0);
    const uploads = drive.uploadCount;
    const names = snaps().map((f) => f.name).sort();
    const r = await run(1);
    expect(r).toEqual({ ok: true, skipped: true, uploadedImages: 0, snapshot: 'recipes-20260101-030000' });
    expect(drive.uploadCount).toBe(uploads);
    expect(snaps().map((f) => f.name).sort()).toEqual(names);
    expect(getBackupStatus(db)).toEqual({
      lastRunAt: day(1)().toISOString(), lastSuccessAt: day(1)().toISOString(), lastError: null,
      lastUploadAt: day(0)().toISOString(),
    });
  });

  it('a skipped run clears a previous error', async () => {
    await run(0);
    db.prepare("INSERT INTO settings(key, value) VALUES ('backup.lastError', 'old')").run();
    await run(1);
    expect(getBackupStatus(db).lastError).toBeNull();
  });

  it('skipped snapshot is the newest existing one', async () => {
    await run(0);
    await run(1, { force: true });
    expect(await run(2)).toMatchObject({ skipped: true, snapshot: 'recipes-20260102-030000' });
  });

  it('after editing a recipe, a full backup uploads a new pair and updates the fingerprint', async () => {
    await run(0);
    const id = repo().list({})[0].id;
    repo().update(id, input('Soup v2'));
    const before = drive.uploadCount;
    const r = await run(1);
    expect(r).toMatchObject({ ok: true, snapshot: 'recipes-20260102-030000' });
    expect((r as { skipped?: true }).skipped).toBeUndefined();
    expect(drive.uploadCount - before).toBe(2);
    expect(getBackupFingerprint(db)).toBe(await computeFingerprint(db, dir));
    expect(getBackupStatus(db).lastUploadAt).toBe(day(1)().toISOString());
  });

  it('a forced run on unchanged data uploads', async () => {
    await run(0);
    const before = drive.uploadCount;
    const r = await run(1, { force: true });
    expect((r as { skipped?: true }).skipped).toBeUndefined();
    expect(drive.uploadCount - before).toBe(2);
  });

  it('unchanged but Drive lost the snapshot pair: full backup', async () => {
    await run(0);
    for (const f of snaps()) await drive.remove(f.id);
    const r = await run(1);
    expect((r as { skipped?: true }).skipped).toBeUndefined();
    expect(snaps().map((f) => f.name).sort()).toEqual(['recipes-20260102-030000.json', 'recipes-20260102-030000.sqlite']);
  });

  it('unchanged but only a lone unrecognised file in snapshots: full backup', async () => {
    await run(0);
    for (const f of snaps()) await drive.remove(f.id);
    const p = path.join(dir, 'x');
    writeFileSync(p, 'x');
    await drive.upload({ folderId: drive.folderId('snapshots', drive.folderId('Recipes backup'))!, name: 'notes.txt', filePath: p });
    expect(((await run(1)) as { skipped?: true }).skipped).toBeUndefined();
  });

  it('unchanged but an image is gone from Drive: full backup re-uploads it', async () => {
    await run(0);
    const gone = imgs().find((f) => f.name === H1)!;
    await drive.remove(gone.id);
    const r = await run(1);
    expect(r).toMatchObject({ ok: true, uploadedImages: 1 });
    expect((r as { skipped?: true }).skipped).toBeUndefined();
    expect(imgs().map((f) => f.name)).toContain(H1);
  });

  it('an auth error during the skip check fails the run and leaves the fingerprint', async () => {
    await run(0);
    const fp = getBackupFingerprint(db);
    drive.failWith(Object.assign(new Error('invalid_grant'), { code: 401 }));
    const r = await run(1);
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/authori[sz]ation/i) });
    const status = getBackupStatus(db);
    expect(deriveBanner({ connected: true, connectedSince: null, ...status }, day(1)())).toBe('failed');
    expect(status.lastUploadAt).toBe(day(0)().toISOString());
    expect(getBackupFingerprint(db)).toBe(fp);
  });

  it('a failed full run does not store the fingerprint', async () => {
    drive.failOnUpload(3);
    expect((await run(0)).ok).toBe(false);
    expect(getBackupFingerprint(db)).toBeNull();
    expect(getBackupStatus(db).lastUploadAt).toBeNull();
  });

  it('a recipe changed while the run is in progress is picked up by the next run', async () => {
    drive.onUpload = () => {
      drive.onUpload = undefined;
      repo().create(input('Mid-run'));
    };
    expect((await run(0)).ok).toBe(true);
    const r = await run(1);
    expect(r.ok).toBe(true);
    expect((r as { skipped?: true }).skipped).toBeUndefined();
    expect(getBackupFingerprint(db)).toBe(await computeFingerprint(db, dir));
    expect(((await run(2)) as { skipped?: true }).skipped).toBe(true);
  });

  const putSnap = async (name: string) => {
    const p = path.join(dir, 'x');
    writeFileSync(p, name);
    const folderId = await drive.ensureFolder('snapshots', await drive.ensureFolder('Recipes backup'));
    await drive.upload({ folderId, name, filePath: p });
  };
  const removeSnap = async (name: string) => {
    for (const f of snaps()) if (f.name === name) await drive.remove(f.id);
  };
  const notSkipped = (r: unknown) => expect((r as { skipped?: true }).skipped).toBeUndefined();

  it('stores the snapshot base name with the fingerprint', async () => {
    await run(0);
    expect(getBackupSnapshot(db)).toBe('recipes-20260101-030000');
  });

  it('exact last pair deleted but an OLDER pair remains: full backup', async () => {
    await putSnap('recipes-20251201-030000.sqlite');
    await putSnap('recipes-20251201-030000.json');
    await run(0);
    await removeSnap('recipes-20260101-030000.sqlite');
    await removeSnap('recipes-20260101-030000.json');
    const r = await run(1);
    notSkipped(r);
    expect(snaps().map((f) => f.name)).toContain('recipes-20260102-030000.sqlite');
  });

  it('a lone .sqlite or lone .json for the last stamp: full backup', async () => {
    await run(0);
    await removeSnap('recipes-20260101-030000.json');
    notSkipped(await run(1));
    await removeSnap('recipes-20260102-030000.sqlite');
    notSkipped(await run(2));
  });

  it('shared folder: another newer pair present but ours gone: full backup', async () => {
    await run(0);
    await removeSnap('recipes-20260101-030000.sqlite');
    await removeSnap('recipes-20260101-030000.json');
    await putSnap('recipes-20260301-030000.sqlite');
    await putSnap('recipes-20260301-030000.json');
    notSkipped(await run(1));
  });

  it('stored fingerprint but no lastSnapshot: full backup', async () => {
    await run(0);
    db.prepare("DELETE FROM settings WHERE key = 'backup.lastSnapshot'").run();
    notSkipped(await run(1));
    expect(getBackupSnapshot(db)).toBe('recipes-20260102-030000');
  });

  it('recipe changed after the fingerprint but before the snapshot: next run is not skipped', async () => {
    const orig = db.backup.bind(db);
    let armed = true;
    (db as unknown as { backup: typeof db.backup }).backup = ((...a: Parameters<typeof db.backup>) => {
      if (armed) {
        armed = false;
        repo().create(input('Between fingerprint and snapshot'));
      }
      return orig(...a);
    }) as typeof db.backup;
    expect((await run(0)).ok).toBe(true);
    notSkipped(await run(1));
  });

  it('16 unchanged nightly runs leave exactly one snapshot pair', async () => {
    for (let i = 0; i < 16; i++) expect((await run(i)).ok).toBe(true);
    expect(snaps().map((f) => f.name).sort()).toEqual(['recipes-20260101-030000.json', 'recipes-20260101-030000.sqlite']);
  });
});
