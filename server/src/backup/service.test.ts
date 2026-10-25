import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { createRecipeRepo } from '../recipes/repo.js';
import { FakeDrive } from './fakeDrive.js';
import { createBackupService } from './service.js';
import { getBackupFingerprint, getBackupSnapshot, getBackupStatus } from './status.js';

let dir: string;
let db: ReturnType<typeof openDb>;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'svc-test-'));
  mkdirSync(path.join(dir, 'images'));
  db = openDb(path.join(dir, 'recipes.db'));
  createRecipeRepo(db).create({
    title: 'Soup', description: null, origin: 'mine', sourceName: null, sourceUrl: null, servings: null,
    prepMinutes: null, cookMinutes: null, ingredients: [], steps: [{ text: 'x', imageId: null, ingredients: [] }], notes: null, tags: [], imageIds: [],
  });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('backup service', () => {
  it('a run abandoned at the deadline leaves fingerprint, snapshot and lastUploadAt untouched', async () => {
    const drive = new FakeDrive();
    drive.uploadDelayMs = 40;
    const svc = createBackupService({ db, dataDir: dir, getDrive: async () => drive, deadlineMs: 5 });
    const out = await svc.runNow();
    expect(out).toMatchObject({ status: 'done', result: { ok: false, error: 'Backup timed out' } });
    await new Promise((r) => setTimeout(r, 300)); // let the abandoned run finish
    expect(drive.uploadCount).toBeGreaterThan(0);
    expect(getBackupFingerprint(db)).toBeNull();
    expect(getBackupSnapshot(db)).toBeNull();
    expect(getBackupStatus(db).lastUploadAt).toBeNull();
  });
});
