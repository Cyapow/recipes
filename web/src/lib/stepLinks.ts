import type { Ingredient, Step } from '../../../server/src/recipes/schema';
import { formatIngredientLine } from './text';

const norm = (i: Ingredient): string => formatIngredientLine(i).trim().toLowerCase();

/**
 * Re-point each step's ingredient links after the ingredient list changed. Old ingredient i maps to the first
 * not-yet-used ingredient in the new list with the same normalised line, so duplicate lines map in order.
 * Links with no match are dropped. Pure.
 */
export function remapStepLinks(oldIngredients: Ingredient[], newIngredients: Ingredient[], steps: Step[]): Step[] {
  const used = new Set<number>();
  const mapping = new Map<number, number>();
  const newKeys = newIngredients.map(norm);
  oldIngredients.forEach((old, i) => {
    const key = norm(old);
    const j = newKeys.findIndex((k, idx) => k === key && !used.has(idx));
    if (j >= 0) {
      used.add(j);
      mapping.set(i, j);
    }
  });
  return steps.map((s) => {
    const links = new Set<number>();
    for (const i of s.ingredients) {
      const j = mapping.get(i);
      if (j !== undefined) links.add(j);
    }
    return { ...s, ingredients: [...links].sort((a, b) => a - b) };
  });
}
