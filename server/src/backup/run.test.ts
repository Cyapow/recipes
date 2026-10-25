import Database from 'better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { createRecipeRepo } from '../recipes/repo.js';
import type { RecipeInput } from '../recipes/schema.js';
import { FakeDrive } from './fakeDrive.js';
import { isBackupImageName, runBackup } from './run.js';
import { deriveBanner, getBackupStatus } from './status.js';

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
    const r2 = await runBackup({ db, dataDir: dir, drive, now: day(0) });
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
    for (let i = 0; i < 16; i++) expect((await runBackup({ db, dataDir: dir, drive, now: day(i) })).ok).toBe(true);
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
    for (let i = 0; i < 3; i++) await runBackup({ db, dataDir: dir, drive, now: day(i), keep: 3 });
    expect(snaps()).toHaveLength(6);
    writeFileSync(path.join(dir, 'images', 'd'.repeat(64) + '.jpg'), 'new');
    drive.failOnUpload(drive.uploadCount + 3); // snapshot x2 ok, image fails
    const r = await runBackup({ db, dataDir: dir, drive, now: day(3), keep: 3 });
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
      expect((await runBackup({ db, dataDir: dir, drive, now: day(1), tmpRoot: root })).ok).toBe(false);
      expect(readdirSync(root)).toEqual([]);
      expect(existsSync(root)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
