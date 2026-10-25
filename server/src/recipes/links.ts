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
 * Indexes of the ingredients whose significant words ALL appear (whole word, case-insensitive, plural-folded)
 * in the step text. Deliberately conservative: "Brown the mince" does not link "beef mince".
 */
export function linkIngredients(stepText: string, ingredients: Ingredient[]): number[] {
  const stepWords = new Set(tokenize(stepText).map(foldPlural));
  const out: number[] = [];
  ingredients.forEach((ing, i) => {
    const words = significantWords(ing.item);
    if (words.length > 0 && words.every((w) => stepWords.has(w))) out.push(i);
  });
  return out;
}
