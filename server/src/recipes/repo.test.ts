import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { createRecipeRepo } from './repo.js';
import type { RecipeInput } from './schema.js';

const base: RecipeInput = {
  title: 'Spaghetti Bolognese',
  description: 'Classic',
  origin: 'mine',
  sourceName: null,
  sourceUrl: null,
  servings: 4,
  prepMinutes: 10,
  cookMinutes: 50,
  ingredients: [
    { group: 'Sauce', quantity: 500, unit: 'g', item: 'beef mince', note: 'lean' },
    { group: null, quantity: null, unit: null, item: 'salt', note: 'to taste' },
  ],
  steps: ['Brown the mince', 'Simmer'],
  notes: 'Better next day',
  tags: ['pasta', 'dinner'],
  imageIds: ['img1', 'img2'],
};

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
    repo.create({ ...base, title: 'Other', origin: 'other', tags: ['soup'] });
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
    repo.create({ ...base, tags: ['pasta', 'Zesty', 'brunch'] });
    expect(repo.tags()).toEqual(['Zesty', 'brunch', 'dinner', 'pasta']);
  });
});
