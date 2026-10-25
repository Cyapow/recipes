import type { Database } from 'better-sqlite3';
import crypto from 'node:crypto';
import type { Ingredient } from '../recipes/schema.js';
import { formatShoppingText, normaliseItemName, normaliseUnit } from './normalise.js';

export type ShoppingSource = { recipeId: string; title: string };
export type ShoppingItem = {
  id: string;
  text: string;
  item: string;
  quantity: number | null;
  unit: string | null;
  sources: ShoppingSource[];
};

type Row = {
  id: string;
  merge_key: string;
  item: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  sources_json: string;
  added_at: string;
  merged: number;
};

function toItem(r: Row): ShoppingItem {
  return {
    id: r.id,
    text: formatShoppingText(r.quantity, r.unit, r.item, r.note, r.merged === 1),
    item: r.item,
    quantity: r.quantity,
    unit: r.unit,
    sources: JSON.parse(r.sources_json),
  };
}

export function createShoppingRepo(db: Database) {
  const listStmt = db.prepare('SELECT * FROM shopping_items ORDER BY added_at, rowid');
  const onListStmt = db.prepare(
    `SELECT 1 FROM shopping_items, json_each(shopping_items.sources_json)
     WHERE json_extract(json_each.value, '$.recipeId') = ? LIMIT 1`,
  );
  const mergeCandidate = db.prepare(
    'SELECT * FROM shopping_items WHERE merge_key = ? AND quantity > 0 AND note IS NULL ORDER BY added_at, rowid LIMIT 1',
  );
  const insert = db.prepare(
    `INSERT INTO shopping_items (id, merge_key, item, quantity, unit, note, sources_json, added_at, merged)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  );
  const updateMerged = db.prepare(
    'UPDATE shopping_items SET quantity = ?, sources_json = ?, merged = 1 WHERE id = ?',
  );

  const addAll = db.transaction((recipe: { id: string; title: string }, ingredients: Ingredient[]) => {
    const now = new Date().toISOString();
    for (const ing of ingredients) {
      const unit = ing.unit?.trim() || null;
      const note = ing.note?.trim() || null;
      const key = `${normaliseItemName(ing.item)}|${normaliseUnit(unit) ?? ''}`;
      // Merge only exact, fully numeric matches. Vague (no quantity) or annotated lines stay separate.
      const mergeable = ing.quantity !== null && ing.quantity > 0 && note === null;
      const existing = mergeable ? (mergeCandidate.get(key) as Row | undefined) : undefined;
      if (existing) {
        const sources: ShoppingSource[] = JSON.parse(existing.sources_json);
        if (!sources.some((s) => s.recipeId === recipe.id)) sources.push({ recipeId: recipe.id, title: recipe.title });
        const total = Math.round((existing.quantity! + ing.quantity!) * 100) / 100;
        updateMerged.run(total, JSON.stringify(sources), existing.id);
      } else {
        insert.run(
          crypto.randomUUID(), key, ing.item.trim(), ing.quantity, unit, note,
          JSON.stringify([{ recipeId: recipe.id, title: recipe.title }]), now,
        );
      }
    }
    return ingredients.length;
  });

  return {
    list(): ShoppingItem[] {
      return (listStmt.all() as Row[]).map(toItem);
    },
    add(
      recipe: { id: string; title: string },
      ingredients: Ingredient[],
      opts: { force?: boolean } = {},
    ): { added: number } | { alreadyOnList: true } {
      if (!opts.force && onListStmt.get(recipe.id)) return { alreadyOnList: true };
      return { added: addAll(recipe, ingredients) };
    },
    remove(id: string): boolean {
      return db.prepare('DELETE FROM shopping_items WHERE id = ?').run(id).changes > 0;
    },
    clear(): number {
      return db.prepare('DELETE FROM shopping_items').run().changes;
    },
  };
}
export type ShoppingRepo = ReturnType<typeof createShoppingRepo>;
