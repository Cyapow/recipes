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
    expect(repo.list({ tags: [pasta] }).map((r) => r.title)).toEqual(['Spaghetti Bolognese']);
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

  describe('brand and tag filters', () => {
    const thai = { group: 'cuisine' as const, name: 'Thai' };
    const italian = { group: 'cuisine' as const, name: 'Italian' };
    const dinner = { group: 'meal' as const, name: 'Dinner' };
    const mk = (title: string, brand: string | null, tags: RecipeInput['tags'], sourceUrl: string | null = null) =>
      repo.create({ ...base, title, brand, origin: brand === 'Mine' ? 'mine' : 'other', tags, sourceUrl });
    const titles = (q: Parameters<typeof repo.list>[0]) => repo.list(q).map((r) => r.title).sort();

    beforeEach(() => {
      mk('GoustoThai', 'Gousto', [thai, dinner]);
      mk('HFThai', 'HelloFresh', [thai]);
      mk('GoustoItalian', 'Gousto', [italian]);
      mk('Plain', 'Mine', []);
    });

    it('ORs brands and ANDs them with tags', () => {
      expect(titles({ brands: ['Gousto', 'HelloFresh'], tags: [thai] })).toEqual(['GoustoThai', 'HFThai']);
      expect(titles({ brands: ['gousto'] })).toEqual(['GoustoItalian', 'GoustoThai']);
    });

    it('ORs tags within a group', () => {
      expect(titles({ brands: ['Gousto'], tags: [thai, italian] })).toEqual(['GoustoItalian', 'GoustoThai']);
    });

    it('ANDs across groups', () => {
      expect(titles({ tags: [thai, dinner] })).toEqual(['GoustoThai']);
    });

    it('searches brand but not tag group ids', () => {
      expect(titles({ search: 'other' })).toEqual([]);
      expect(titles({ search: 'gousto' })).toEqual(['GoustoItalian', 'GoustoThai']);
      expect(titles({ search: 'thai' })).toEqual(['GoustoThai', 'HFThai']);
    });

    it('finds a tag whose name contains a colon', () => {
      mk('Spicy', null, [{ group: 'other', name: 'Middle Eastern: spicy' }]);
      expect(titles({ tags: [{ group: 'other', name: 'middle eastern: spicy' }] })).toEqual(['Spicy']);
    });

    it('facets() counts brands and tags, count desc then name', () => {
      expect(repo.facets()).toEqual({
        brands: [
          { name: 'Gousto', count: 2 },
          { name: 'HelloFresh', count: 1 },
          { name: 'Mine', count: 1 },
        ],
        tags: [
          { group: 'cuisine', name: 'Thai', count: 2 },
          { group: 'meal', name: 'Dinner', count: 1 },
          { group: 'cuisine', name: 'Italian', count: 1 },
        ],
      });
    });

    it('brandForHost returns the newest brand for a host, www stripped', async () => {
      mk('Old', 'Gousto', [], 'https://www.bbcgoodfood.com/a');
      await new Promise((r) => setTimeout(r, 5));
      mk('New', 'Simply Cook', [], 'https://bbcgoodfood.com/b');
      mk('NoBrand', null, [], 'https://bbcgoodfood.com/c');
      expect(repo.brandForHost('bbcgoodfood.com')).toBe('Simply Cook');
      expect(repo.brandForHost('nowhere.example')).toBeNull();
    });
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
