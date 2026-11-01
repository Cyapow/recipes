/**
 * Splitting one written ingredient line into an amount and an item: "1 lb ground beef" into 1, lb and ground beef.
 *
 * Shared by the editor's ingredient box and by the URL importer, so a recipe typed by hand and the same recipe
 * imported from a page end up stored the same way. A line this cannot read keeps its whole text as the item: a
 * stranded unit with no number ("tbsp vegetable oil") is worse than no parsing at all.
 */

export const UNITS = new Set([
  'tsp', 'tbsp', 'teaspoon', 'teaspoons', 'tablespoon', 'tablespoons', 'cup', 'cups',
  'g', 'kg', 'mg', 'ml', 'l', 'litre', 'litres', 'liter', 'liters',
  'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds',
  'pint', 'pints', 'quart', 'quarts', 'gallon', 'gallons',
  'pinch', 'pinches', 'clove', 'cloves', 'tin', 'tins', 'can', 'cans', 'slice', 'slices',
  'bunch', 'bunches', 'handful', 'handfuls', 'stick', 'sticks', 'sprig', 'sprigs',
]);

// Units written as two words, checked before the single-word list so "fl oz" does not come out as "fl".
const TWO_WORD_UNITS = new Set(['fl oz', 'fluid ounce', 'fluid ounces']);

// Recipes written for an American kitchen use these characters rather than "1/2".
const FRACTIONS: Record<string, number> = {
  '¼': 1 / 4, '½': 1 / 2, '¾': 3 / 4, '⅐': 1 / 7, '⅑': 1 / 9, '⅒': 1 / 10,
  '⅓': 1 / 3, '⅔': 2 / 3, '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
};
const GLYPHS = Object.keys(FRACTIONS).join('');

/** A quantity: "2", "1.5", "1/2", "1 1/2", "½" or "1½" (the glyph needs no space before it). */
const QUANTITY = new RegExp(`^(\\d+(?:\\.\\d+)?)?\\s*([${GLYPHS}])\\s+|^(\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d+(?:\\.\\d+)?)\\s+`);
// "500g flour": a compact metric unit written against the number, which no other unit is.
const ATTACHED = /^(\d+(?:\.\d+)?)(g|kg|ml|l)\s+(.+)$/i;

/** Two decimals, so a third of a teaspoon is stored as 0.33 rather than 0.3333333333333333. */
const round = (n: number): number => Math.round(n * 100) / 100;

function fractionValue(whole: string | undefined, glyph: string): number {
  return round((whole ? Number(whole) : 0) + FRACTIONS[glyph]!);
}

function mixedValue(s: string): number | null {
  const m = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(s);
  if (m) return round(Number(m[1] ?? 0) + Number(m[2]!) / Number(m[3]!));
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

export type SplitAmount = { quantity: number | null; unit: string | null; item: string; note: string | null };

/** The unit at the front of what is left, and the item after it. */
function splitUnit(rest: string): { unit: string | null; item: string } {
  const words = rest.split(/\s+/);
  const two = words.slice(0, 2).join(' ').toLowerCase();
  if (words.length > 2 && TWO_WORD_UNITS.has(two)) {
    return { unit: words.slice(0, 2).join(' '), item: words.slice(2).join(' ') };
  }
  // A unit only counts when a word is left over to name the item: "2 cups" on its own is two cups of something.
  if (words.length > 1 && UNITS.has(words[0]!.toLowerCase())) {
    return { unit: words[0]!, item: words.slice(1).join(' ') };
  }
  return { unit: null, item: rest };
}

// "2-3 tablespoons", "1–1½ lb", "2 to 3 tsp". A range is still a number: we cook to the lower end and keep the
// range in the note, rather than storing no quantity at all and stranding the unit at the front of the item.
const NUMBER = `\\d+(?:\\.\\d+)?[${GLYPHS}]?|[${GLYPHS}]`;
const RANGE = new RegExp(`^(${NUMBER})\\s*(?:-|–|—|to)\\s*(?:${NUMBER})\\s+`);

function numberValue(s: string): number | null {
  const m = new RegExp(`^(\\d+(?:\\.\\d+)?)?([${GLYPHS}])$`).exec(s);
  if (m) return fractionValue(m[1], m[2]!);
  return mixedValue(s);
}

export function splitAmount(line: string): SplitAmount {
  let rest = line.trim();
  let note: string | null = null;
  const n = /\s*\(([^()]*)\)\s*$/.exec(rest);
  if (n && n.index > 0) {
    note = n[1]!.trim() || null;
    rest = rest.slice(0, n.index);
  }

  const att = ATTACHED.exec(rest);
  if (att) return { quantity: Number(att[1]), unit: att[2]!, item: att[3]!.trim(), note };

  const range = RANGE.exec(rest);
  if (range) {
    const low = numberValue(range[1]!);
    if (low != null) {
      const { unit, item } = splitUnit(rest.slice(range[0].length).trim());
      const asWritten = [range[0].trim(), unit].filter(Boolean).join(' ');
      return { quantity: low, unit, item, note: note ?? asWritten };
    }
  }

  const q = QUANTITY.exec(rest);
  if (!q) return { quantity: null, unit: null, item: rest.trim(), note };
  const quantity = q[2] ? fractionValue(q[1], q[2]) : mixedValue(q[3]!);
  rest = rest.slice(q[0].length).trim();
  if (quantity == null) return { quantity: null, unit: null, item: line.trim(), note };
  return { quantity, ...splitUnit(rest), note };
}

/**
 * The units the editor offers, in the order it offers them. No unit comes first: most ingredients have none
 * ("1 small yellow onion", "0.5 beef bouillon cube").
 */
export const UNIT_CHOICES = ['g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'lb', 'oz', 'fl oz', 'pint', 'quart',
  'pinch', 'clove', 'slice', 'tin', 'can', 'bunch', 'sprig', 'stick', 'handful'];

// The same unit written another way. Imports arrive with all of these, which is why one recipe can hold "tsp",
// "teaspoon" and "teaspoons" at once; picking from the list settles on one spelling.
const SAME_UNIT: Record<string, string> = {
  teaspoon: 'tsp', teaspoons: 'tsp', tsps: 'tsp',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp',
  cups: 'cup', grams: 'g', gram: 'g', gs: 'g', kilograms: 'kg', kilogram: 'kg',
  millilitres: 'ml', millilitre: 'ml', milliliters: 'ml', milliliter: 'ml',
  litre: 'l', litres: 'l', liter: 'l', liters: 'l',
  pounds: 'lb', lbs: 'lb', ounce: 'oz', ounces: 'oz',
  'fluid ounce': 'fl oz', 'fluid ounces': 'fl oz', floz: 'fl oz',
  pints: 'pint', quarts: 'quart', pinches: 'pinch', cloves: 'clove', slices: 'slice',
  tins: 'tin', cans: 'can', bunches: 'bunch', sprigs: 'sprig', sticks: 'stick', handfuls: 'handful',
};

/** The listed spelling of a unit, or the unit as written when it is not one we know. */
export function canonicalUnit(unit: string | null): string | null {
  if (unit == null) return null;
  const u = unit.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  if (u === '') return null;
  return SAME_UNIT[u] ?? (UNIT_CHOICES.includes(u) ? u : unit.trim());
}
