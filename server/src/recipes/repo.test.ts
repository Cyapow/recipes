import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { createRecipeRepo } from './repo.js';
import type { RecipeInput } from './schema.js';

const base: RecipeInput = {
  title: 'Spaghetti Bolognese',
  description: 'Classic',
  origin: 'mine',
  brand: 'Mine',
  sourceName: null,
  sourceUrl: null,
  servings: 4,
  prepMinutes: 10,
  cookMinutes: 50,
  ingredients: [
    { group: 'Sauce', quantity: 500, unit: 'g', item: 'beef mince', note: 'lean' },
    { group: null, quantity: null, unit: null, item: 'salt', note: 'to taste' },
  ],
  steps: [
    { text: 'Brown the mince', imageId: null, ingredients: [0] },
    { text: 'Simmer', imageId: 'b'.repeat(64) + '.jpg', ingredients: [] },
  ],
  notes: 'Better next day',
  tags: [
    { group: 'main', name: 'pasta' },
    { group: 'meal', name: 'dinner' },
  ],
  imageIds: ['img1', 'img2'],
};

const tag = (name: string) => ({ group: 'other' as const, name });
const pasta = { group: 'main' as const, name: 'pasta' };

let repo: ReturnType<typeof createRecipeRepo>;
beforeEach(() => {
  repo = createRecipeRepo(openDb(':memory:'));
});

describe('recipe repo', () => {
  it('round-trips every field', () => {
    const created = repo.create(base);
    const got = repo.get(created.id)!;
    expect(got).toEqual(created);
    const { id, createdAt, updatedAt, ...rest } = got;
    expect(rest).toEqual(base);
    expect(id).toBeTruthy();
    expect(createdAt).toBeTruthy();
    expect(updatedAt).toBeTruthy();
    expect(got.ingredients[1].quantity).toBeNull();
    expect(got.ingredients[0].group).toBe('Sauce');
  });

  it('update bumps updatedAt not createdAt', async () => {
    const c = repo.create(base);
    await new Promise((r) => setTimeout(r, 5));
    const u = repo.update(c.id, { ...base, title: 'New' })!;
    expect(u.title).toBe('New');
    expect(u.createdAt).toBe(c.createdAt);
    expect(u.updatedAt).not.toBe(c.updatedAt);
    expect(repo.update('missing', base)).toBeUndefined();
  });

  it('delete returns true then get is undefined', () => {
    const c = repo.create(base);
    expect(repo.delete(c.id)).toBe(true);
    expect(repo.get(c.id)).toBeUndefined();
    expect(repo.delete(c.id)).toBe(false);
  });

  it('list searches ingredient items, case-insensitively', () => {
    repo.create(base);
    repo.create({ ...base, title: 'Salad', ingredients: [{ group: null, quantity: 1, unit: null, item: 'lettuce', note: null }], tags: [] });
    expect(repo.list({ search: 'mince' }).map((r) => r.title)).toEqual(['Spaghetti Bolognese']);
    expect(repo.list({ search: 'MINCE' })).toHaveLength(1);
    expect(repo.list({ search: 'sALaD' })).toHaveLength(1);
  });

  it('list filters by origin and tag', () => {
    repo.create(base);
    repo.create({ ...base, title: 'Other', origin: 'other', brand: 'Gousto', tags: [{ group: 'other', name: 'soup' }] });
    expect(repo.list({ origin: 'mine' }).map((r) => r.title)).toEqual(['Spaghetti Bolognese']);
    expect(repo.list({ tag: 'pasta' }).map((r) => r.title)).toEqual(['Spaghetti Bolognese']);
    expect(repo.list({})).toHaveLength(2);
  });

  it('list returns summaries with thumbnail and total minutes', () => {
    repo.create(base);
    repo.create({ ...base, title: 'Bare', prepMinutes: null, cookMinutes: null, imageIds: [] });
    const rows = repo.list({});
    const full = rows.find((r) => r.title === 'Spaghetti Bolognese')!;
    expect(full.thumbnailId).toBe('img1');
    expect(full.totalMinutes).toBe(60);
    expect(full).not.toHaveProperty('ingredients');
    const bare = rows.find((r) => r.title === 'Bare')!;
    expect(bare.thumbnailId).toBeNull();
    expect(bare.totalMinutes).toBeNull();
  });

  it('tags() returns distinct sorted tags', () => {
    repo.create(base);
    repo.create({ ...base, tags: [pasta, tag('Zesty'), tag('brunch')] });
    expect(repo.tags()).toEqual(['Zesty', 'brunch', 'dinner', 'pasta']);
  });

  it('reads a legacy string-array tags_json as Other tags and a missing brand as null', () => {
    const db = openDb(':memory:');
    const r = createRecipeRepo(db);
    const c = r.create(base);
    db.prepare('UPDATE recipes SET tags_json = ?, brand = NULL WHERE id = ?').run('["pasta","dinner"]', c.id);
    const got = r.get(c.id)!;
    expect(got.tags).toEqual([tag('pasta'), tag('dinner')]);
    expect(got.brand).toBeNull();
    expect(r.list({})[0]).toMatchObject({ brand: null, tags: [tag('pasta'), tag('dinner')] });
  });

  it('does not match the group word when searching', () => {
    repo.create(base);
    expect(repo.list({ search: 'other' })).toHaveLength(0);
    expect(repo.list({ search: 'dinn' })).toHaveLength(1);
  });

  it('repo.get never throws on malformed stored steps and always yields valid Steps', () => {
    const db = openDb(':memory:');
    const r = createRecipeRepo(db);
    const c = r.create(base); // 2 ingredients
    const H = 'd'.repeat(64) + '.jpg';
    const stored = [
      'legacy',
      { text: 'ok', imageId: H, ingredients: [1, 0, 1, 2, -1, 0.5, 'x'] },
      { text: 5 },
      null,
      42,
      { text: 'badimg', imageId: '../x.jpg' },
    ];
    db.prepare('UPDATE recipes SET steps_json = ? WHERE id = ?').run(JSON.stringify(stored), c.id);
    expect(r.get(c.id)!.steps).toEqual([
      { text: 'legacy', imageId: null, ingredients: [] },
      { text: 'ok', imageId: H, ingredients: [0, 1] },
      { text: 'badimg', imageId: null, ingredients: [] },
    ]);
    for (const bad of ['not json', '{"a":1}', 'null']) {
      db.prepare('UPDATE recipes SET steps_json = ? WHERE id = ?').run(bad, c.id);
      expect(r.get(c.id)!.steps).toEqual([]);
      expect(r.list({})).toHaveLength(1);
    }
  });
});
