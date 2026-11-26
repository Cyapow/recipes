import { mentionsAnySignificantWord } from '../recipes/links.js';
import type { Gap, Ingredient } from '../recipes/schema.js';

/** The most gaps one draft carries; the model is told to put the most important first. */
export const MAX_GAPS = 8;
/** The longest question the form shows. A longer one is dropped rather than cut mid-sentence. */
export const MAX_QUESTION_CHARS = 140;

/**
 * Hold the model's gaps to the limits the form relies on: a blank or over-long question becomes null (the gap
 * stays, as a plain note), and only the first MAX_GAPS are kept. Idempotent, so it is safe to run twice.
 */
export function normaliseGaps(gaps: Gap[]): Gap[] {
  return gaps.slice(0, MAX_GAPS).map(({ about, question }) => ({
    about,
    question: question !== null && question.trim() !== '' && question.length <= MAX_QUESTION_CHARS ? question : null,
  }));
}

/**
 * Gaps for ingredients that are listed with an amount but that no step uses. Nothing is missing from the
 * recipe as written, so the model has no reason to report it; only a set difference over the final step
 * links can. Skips an ingredient the model already raised, and one that can never link to any step.
 */
export function unusedIngredientGaps(
  recipe: { ingredients: Ingredient[]; steps: { ingredients: number[] }[] },
  existing: Gap[],
): Gap[] {
  const used = new Set(recipe.steps.flatMap((s) => s.ingredients));
  return recipe.ingredients.flatMap((ingredient, i): Gap[] => {
    if (used.has(i) || ingredient.quantity === null) return [];
    // An item with no significant words cannot match even itself, and so could never be linked to a step.
    if (!mentionsAnySignificantWord(ingredient.item, ingredient)) return [];
    if (existing.some((g) => mentionsAnySignificantWord(`${g.about} ${g.question ?? ''}`, ingredient))) return [];
    const item = ingredient.item.trim();
    return [{ about: `${item} is not used in any step`, question: `Which step uses the ${item}?` }];
  });
}
