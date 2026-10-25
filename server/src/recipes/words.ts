/** Lower-case word tokens (letters only, so digits and punctuation never form words). */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/\p{L}+/gu) ?? [];
}

// Words that already look plural (or are not) and must be left exactly as they are.
const KEEP_AS_IS = new Set(['hummus', 'couscous', 'asparagus', 'molasses', 'watercress', 'swiss', 'grass', 'citrus']);

/**
 * Conservative singular form for comparing words on both sides of a match:
 * onions->onion, tomatoes->tomato, berries->berry, peaches->peach. Anything unsure is left alone.
 */
export function foldPlural(word: string): string {
  if (word.length <= 3 || KEEP_AS_IS.has(word)) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes') || word.endsWith('ches') || word.endsWith('shes') || word.endsWith('xes')) return word.slice(0, -2);
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}
