import type { Ingredient } from './schema.js';
import { foldPlural, tokenize } from './words.js';

// Descriptors, connectives and units that say nothing about which ingredient is meant.
const STOP_WORDS = new Set([
  'chopped', 'diced', 'fresh', 'finely', 'roughly', 'large', 'small', 'medium', 'ground', 'grated', 'sliced', 'minced',
  'crushed', 'peeled', 'whole', 'dried', 'frozen', 'optional', 'plus', 'extra', 'of', 'and', 'or', 'the', 'a', 'an', 'to',
  'taste', 'for', 'with', 'in', 'tin', 'tins', 'can', 'cans', 'g', 'kg', 'mg', 'ml', 'l', 'cl', 'dl', 'tbsp', 'tsp', 'oz',
  'lb', 'lbs', 'clove', 'cloves', 'pinch', 'handful', 'x',
].map(foldPlural));

/** Folded significant words of an ingredient's item text. */
function significantWords(item: string): string[] {
  return [...new Set(tokenize(item).map(foldPlural).filter((w) => !STOP_WORDS.has(w)))];
}

/**
 * True when at least ONE significant word of the ingredient appears in the step text (whole word,
 * accent-, case- and plural-insensitive). Looser than linkIngredients, which needs all of them.
 */
export function mentionsAnySignificantWord(stepText: string, ingredient: Pick<Ingredient, 'item'>): boolean {
  const stepWords = new Set(tokenize(stepText).map(foldPlural));
  return significantWords(ingredient.item).some((w) => stepWords.has(w));
}

/**
 * Indexes of the ingredients whose significant words ALL appear (whole word, case-insensitive, plural-folded)
 * in the step text. Deliberately conservative: "Brown the mince" does not link "beef mince".
 */
export function linkIngredients(stepText: string, ingredients: Ingredient[]): number[] {
  const stepWords = new Set(tokenize(stepText).map(foldPlural));
  const matched: Array<{ i: number; words: string[] }> = [];
  ingredients.forEach((ing, i) => {
    const words = significantWords(ing.item);
    if (words.length > 0 && words.every((w) => stepWords.has(w))) matched.push({ i, words });
  });
  // Longest match wins: drop an ingredient whose words are a strict subset of another match's
  // ("red wine" under "red wine vinegar"). A missing link is safer than a false one.
  return matched
    .filter((a) => !matched.some((b) => b.words.length > a.words.length && a.words.every((w) => b.words.includes(w))))
    .map((m) => m.i);
}
