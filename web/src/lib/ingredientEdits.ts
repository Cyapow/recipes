import type { Ingredient, Step } from '../../../server/src/recipes/schema';

/**
 * Removing and reordering ingredients, with the steps' links following them.
 *
 * A step stores the positions of the ingredients it uses, so moving or deleting a row silently re-points
 * "Ingredients used in step 1" at whatever landed in that position. These apply the same change to both lists at
 * once, which is only possible because a row edit is a discrete action rather than a text box being retyped.
 */

type Edit = { ingredients: Ingredient[]; steps: Step[] };

/** Apply a position mapping to every step; a link whose ingredient has gone is dropped. */
function relink(steps: Step[], to: (index: number) => number | null): Step[] {
  return steps.map((s) => {
    const moved = s.ingredients.map(to).filter((n): n is number => n !== null);
    return { ...s, ingredients: [...new Set(moved)].sort((a, b) => a - b) };
  });
}

export function removeIngredient(ingredients: Ingredient[], steps: Step[], index: number): Edit {
  if (index < 0 || index >= ingredients.length) return { ingredients, steps };
  return {
    ingredients: ingredients.filter((_, i) => i !== index),
    steps: relink(steps, (i) => (i === index ? null : i > index ? i - 1 : i)),
  };
}

export function moveIngredient(ingredients: Ingredient[], steps: Step[], from: number, to: number): Edit {
  const n = ingredients.length;
  if (from === to || from < 0 || from >= n || to < 0 || to >= n) return { ingredients, steps };
  const next = ingredients.slice();
  next.splice(to, 0, next.splice(from, 1)[0]!);
  // Where each old position ended up: the moved one lands on `to`, and the rows it passed shift by one.
  const at = (i: number) => (i === from ? to : from < i && i <= to ? i - 1 : to <= i && i < from ? i + 1 : i);
  return { ingredients: next, steps: relink(steps, at) };
}
