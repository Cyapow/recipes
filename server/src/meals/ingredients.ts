import type { Ingredient } from '../recipes/schema.js';
import { ingredientKey, toBase } from '../planner/suggest.js';
import { formatShoppingText } from '../shopping/normalise.js';

/** What one recipe asked for, as written: kept so prepping can see "finely chopped" and "for the sauce". */
export type MealIngredientUse = {
  recipeTitle: string;
  group: string | null;
  note: string | null;
  quantity: number | null;
  unit: string | null;
  item: string;
};

export type MealIngredientLine = {
  key: string;
  item: string;
  /** The base unit (kg is g, l is ml); '' for a bare count. */
  unit: string;
  /** The total, or null when any recipe's amount is vague, in which case `uses` carries the detail. */
  quantity: number | null;
  text: string;
  uses: MealIngredientUse[];
};

/**
 * One ingredient list for a whole meal. Unlike the Planner's fold, which prices a shopping trip, this is for
 * cooking: staples stay, quantities are added up, and each recipe's note and group are kept. An item measured
 * two ways stays as two lines rather than a total that would be a lie.
 */
export function mergeMealIngredients(recipes: { title: string; ingredients: Ingredient[] }[]): MealIngredientLine[] {
  const groups = new Map<string, MealIngredientLine>();
  for (const r of recipes) {
    for (const ing of r.ingredients) {
      const key = ingredientKey(ing.item);
      if (!key) continue;
      const numeric = ing.quantity !== null && Number.isFinite(ing.quantity);
      const unit = toBase(numeric ? ing.quantity! : 0, ing.unit).unit;
      const id = `${key}\u0000${unit}`;
      let line = groups.get(id);
      if (!line) {
        line = { key, item: ing.item.trim(), unit, quantity: 0, text: '', uses: [] };
        groups.set(id, line);
      }
      line.uses.push({
        recipeTitle: r.title, group: ing.group, note: ing.note, quantity: ing.quantity, unit: ing.unit, item: ing.item,
      });
      line.quantity = numeric && line.quantity !== null ? line.quantity + toBase(ing.quantity!, ing.unit).quantity : null;
    }
  }
  const lines = [...groups.values()];
  for (const l of lines) l.text = formatShoppingText(l.quantity, l.unit || null, l.item, null, true);
  return lines.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
