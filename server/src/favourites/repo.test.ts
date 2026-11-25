import { describe, it, expect, beforeEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDb } from '../db.js';
import { createFavouritesRepo, type FavouritesRepo } from './repo.js';

const now = new Date('2026-01-01T00:00:00Z');
const [r1, r2, r3] = ['r1', 'r2', 'r3'] as const;

describe('favourites repo', () => {
  let db: Database;
  let repo: FavouritesRepo;

  beforeEach(() => {
    db = openDb(':memory:');
    const insert = db.prepare(
      `INSERT INTO recipes (id, title, origin, ingredients_json, steps_json, tags_json, image_ids_json, created_at, updated_at)
       VALUES (?, ?, 'mine', '[]', '[]', '[]', '[]', ?, ?)`,
    );
    for (const id of [r1, r2, r3]) insert.run(id, id, now.toISOString(), now.toISOString());
    repo = createFavouritesRepo(db);
  });

  it('add is idempotent and remove is forgiving', () => {
    repo.add('a@x.com', r1, now);
    repo.add('a@x.com', r1, now);
    expect(repo.forRecipes([r1]).get(r1)).toEqual(['a@x.com']);
    repo.remove('a@x.com', r1);
    repo.remove('a@x.com', r1);
    expect(repo.forRecipes([r1]).get(r1)).toBeUndefined();
  });

  it('normalises the email on the way in', () => {
    repo.add(' A@X.com ', r1, now);
    expect(repo.forRecipes([r1]).get(r1)).toEqual(['a@x.com']);
    repo.remove('  a@X.COM', r1);
    expect(repo.allPairs()).toEqual([]);
  });

  it('forRecipes returns sorted emails per recipe and omits unstarred ones', () => {
    repo.add('b@x.com', r1, now);
    repo.add('a@x.com', r1, now);
    const map = repo.forRecipes([r1, r2]);
    expect(map.get(r1)).toEqual(['a@x.com', 'b@x.com']);
    expect(map.has(r2)).toBe(false);
    expect(repo.forRecipes([]).size).toBe(0);
  });

  it('countsByEmail counts per person', () => {
    repo.add('a@x.com', r1, now);
    repo.add('a@x.com', r2, now);
    repo.add('b@x.com', r1, now);
    expect(repo.countsByEmail()).toEqual(new Map([['a@x.com', 2], ['b@x.com', 1]]));
  });

  it('removeAllFor drops one person and leaves the other', () => {
    repo.add('a@x.com', r1, now);
    repo.add('a@x.com', r2, now);
    repo.add('b@x.com', r1, now);
    repo.removeAllFor(' A@x.com');
    expect(repo.allPairs()).toEqual([{ email: 'b@x.com', recipeId: r1 }]);
  });

  it('allPairs is sorted by email then recipe id', () => {
    repo.add('b@x.com', r1, now);
    repo.add('a@x.com', r2, now);
    repo.add('a@x.com', r1, now);
    expect(repo.allPairs()).toEqual([
      { email: 'a@x.com', recipeId: r1 },
      { email: 'a@x.com', recipeId: r2 },
      { email: 'b@x.com', recipeId: r1 },
    ]);
  });

  it('deleting a recipe deletes its favourites', () => {
    repo.add('a@x.com', r1, now);
    db.prepare('DELETE FROM recipes WHERE id = ?').run(r1);
    expect(repo.countsByEmail().get('a@x.com') ?? 0).toBe(0);
  });

  it('starring never touches the recipe row', () => {
    const before = db.prepare('SELECT * FROM recipes WHERE id = ?').get(r1);
    repo.add('a@x.com', r1, new Date('2027-01-01T00:00:00Z'));
    repo.remove('a@x.com', r1);
    expect(db.prepare('SELECT * FROM recipes WHERE id = ?').get(r1)).toEqual(before);
  });
});
