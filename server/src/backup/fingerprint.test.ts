import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { createRecipeRepo } from '../recipes/repo.js';
import { createShoppingRepo } from '../shopping/repo.js';
import type { RecipeInput } from '../recipes/schema.js';
import { canonicalJson, computeFingerprint } from './fingerprint.js';

const H1 = 'a'.repeat(64) + '.jpg';
const input = (title: string): RecipeInput => ({
  title, description: null, origin: 'mine', sourceName: null, sourceUrl: null, servings: null,
  prepMinutes: null, cookMinutes: null, ingredients: [], steps: [{ text: 'x', imageId: null, ingredients: [] }], notes: null, tags: [], imageIds: [],
});

let dir: string;
let db: ReturnType<typeof openDb>;
let repo: ReturnType<typeof createRecipeRepo>;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'fp-test-'));
  mkdirSync(path.join(dir, 'images'));
  db = openDb(path.join(dir, 'recipes.db'));
  repo = createRecipeRepo(db);
  repo.create(input('Soup'));
  repo.create(input('Stew'));
  writeFileSync(path.join(dir, 'images', H1), 'x');
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
const fp = () => computeFingerprint(db, dir);

describe('computeFingerprint', () => {
  it('(f) is identical for a legacy-string row and the same recipe saved in Step shape', async () => {
    const id = repo.list({})[0].id;
    db.prepare('UPDATE recipes SET steps_json = ? WHERE id = ?').run('["x"]', id);
    const legacy = await fp();
    const before = repo.get(id)!;
    repo.update(id, before as never);
    // updatedAt is part of the hashed recipe and update bumps it; pin it so only the stored step shape differs.
    db.prepare('UPDATE recipes SET updated_at = ? WHERE id = ?').run(before.updatedAt, id);
    expect(JSON.parse((db.prepare('SELECT steps_json FROM recipes WHERE id = ?').get(id) as { steps_json: string }).steps_json)).toEqual([
      { text: 'x', imageId: null, ingredients: [] },
    ]);
    expect(await fp()).toBe(legacy);
  });


  it('is a stable sha256 hex for identical data', async () => {
    const a = await fp();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await fp()).toBe(a);
  });

  it('changes when a recipe is edited, added or deleted', async () => {
    const base = await fp();
    const id = repo.list({})[0].id;
    repo.update(id, { ...input('Soup 2') });
    const edited = await fp();
    expect(edited).not.toBe(base);
    const created = repo.create(input('Pie'));
    const added = await fp();
    expect(added).not.toBe(edited);
    repo.delete(created.id);
    expect(await fp()).not.toBe(added);
  });

  it('changes when a backup image is added, ignores non-image files and settings rows', async () => {
    const base = await fp();
    writeFileSync(path.join(dir, 'images', '.tmp-abc'), 'x');
    writeFileSync(path.join(dir, 'images', 'notes.txt'), 'x');
    db.prepare("INSERT INTO settings(key, value) VALUES ('backup.lastRunAt', 'now')").run();
    expect(await fp()).toBe(base);
    writeFileSync(path.join(dir, 'images', `thumb-${H1}`), 'x');
    expect(await fp()).not.toBe(base);
  });

  it('treats a missing images dir as empty', async () => {
    rmSync(path.join(dir, 'images'), { recursive: true });
    expect(await fp()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('canonical form ignores object key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 1, x: 2 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { x: 2, y: 1 }] }, b: 1 }),
    );
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('ignores the shopping list entirely', async () => {
    const before = await fp();
    const shopping = createShoppingRepo(db);
    const id = repo.list({})[0].id;
    shopping.add({ id, title: 'Soup' }, [{ group: null, quantity: 2, unit: 'tins', item: 'tomatoes', note: null }]);
    expect(await fp()).toBe(before);
    shopping.clear();
    expect(await fp()).toBe(before);
  });
});
