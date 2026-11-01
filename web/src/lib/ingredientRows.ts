import type { Ingredient } from '../../../server/src/recipes/schema';

/**
 * The editor shows a flat list of rows: ingredients, and the headings that sit between them. A recipe stores the
 * heading on each ingredient instead (its `group`), which cannot express a heading with nothing under it yet — so
 * the rows are the editor's own shape, and only what has ingredients under it survives into the recipe.
 */

export type Row =
  | { kind: 'ingredient'; id: string; value: Ingredient }
  | { kind: 'heading'; id: string; text: string };

let next = 0;
const rowId = () => `row-${next++}`;

export function toRows(ingredients: Ingredient[]): Row[] {
  const rows: Row[] = [];
  let group: string | null = null;
  for (const [i, ing] of ingredients.entries()) {
    if (ing.group !== group || i === 0) {
      group = ing.group;
      if (group) rows.push({ kind: 'heading', id: rowId(), text: group });
    }
    rows.push({ kind: 'ingredient', id: rowId(), value: ing });
  }
  return rows;
}

/** The ingredients these rows describe: each one carries the heading it sits under. */
export function toIngredients(rows: Row[]): Ingredient[] {
  const out: Ingredient[] = [];
  let group: string | null = null;
  for (const row of rows) {
    if (row.kind === 'heading') group = row.text.trim() || null;
    else out.push({ ...row.value, group });
  }
  return out;
}

export const newIngredientRow = (): Row =>
  ({ kind: 'ingredient', id: rowId(), value: { group: null, quantity: null, unit: null, item: '', note: null } });

export const newHeadingRow = (): Row => ({ kind: 'heading', id: rowId(), text: '' });

/**
 * Which ingredient position each row holds, so a row's index can be turned into the index a step links by.
 * Heading rows get null: they are not ingredients and nothing links to them.
 */
export function ingredientIndexes(rows: Row[]): (number | null)[] {
  let n = 0;
  return rows.map((r) => (r.kind === 'heading' ? null : n++));
}
