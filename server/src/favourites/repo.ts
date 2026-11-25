import type { Database } from 'better-sqlite3';
import { normaliseEmail } from '../auth/repo.js';

export type FavouritesRepo = {
  add(email: string, recipeId: string, now: Date): void;
  remove(email: string, recipeId: string): void;
  /** email -> how many recipes they have starred */
  countsByEmail(): Map<string, number>;
  /** recipe id -> sorted emails; recipes nobody has starred are absent */
  forRecipes(ids: string[]): Map<string, string[]>;
  removeAllFor(email: string): void;
  /** Sorted, so a fingerprint over it is stable. */
  allPairs(): { email: string; recipeId: string }[];
};

export function createFavouritesRepo(db: Database): FavouritesRepo {
  const insert = db.prepare(
    'INSERT INTO favourites (email, recipe_id, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
  );
  const del = db.prepare('DELETE FROM favourites WHERE email = ? AND recipe_id = ?');
  const delAllFor = db.prepare('DELETE FROM favourites WHERE email = ?');
  const counts = db.prepare('SELECT email, COUNT(*) AS n FROM favourites GROUP BY email');
  const pairs = db.prepare('SELECT email, recipe_id FROM favourites ORDER BY email, recipe_id');

  return {
    add(email, recipeId, now) {
      insert.run(normaliseEmail(email), recipeId, now.toISOString());
    },
    remove(email, recipeId) {
      del.run(normaliseEmail(email), recipeId);
    },
    countsByEmail() {
      const rows = counts.all() as { email: string; n: number }[];
      return new Map(rows.map((r) => [r.email, r.n]));
    },
    forRecipes(ids) {
      const out = new Map<string, string[]>();
      if (ids.length === 0) return out;
      const rows = db
        .prepare(
          `SELECT recipe_id, email FROM favourites WHERE recipe_id IN (${ids.map(() => '?').join(',')})
           ORDER BY recipe_id, email`,
        )
        .all(...ids) as { recipe_id: string; email: string }[];
      for (const r of rows) {
        const list = out.get(r.recipe_id);
        if (list) list.push(r.email);
        else out.set(r.recipe_id, [r.email]);
      }
      return out;
    },
    removeAllFor(email) {
      delAllFor.run(normaliseEmail(email));
    },
    allPairs() {
      return (pairs.all() as { email: string; recipe_id: string }[]).map((r) => ({
        email: r.email,
        recipeId: r.recipe_id,
      }));
    },
  };
}
