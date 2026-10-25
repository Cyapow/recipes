// Conservative text normalisation for shopping-list merging. When unsure, do not fold.

/** Words that look plural (or must never be altered) but are not folded. */
const PROTECTED = new Set([
  'hummus', 'couscous', 'asparagus', 'molasses', 'swiss', 'cress', 'watercress',
  'lentils', 'peas', 'oats', 'greens', 'grits', 'brussels',
]);

function foldWord(w: string): string {
  if (PROTECTED.has(w) || w.length <= 3) return w;
  if (/(ss|us|is)$/.test(w)) return w;
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('oes')) return w.slice(0, -2);
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

export function normaliseItemName(s: string): string {
  const cleaned = s
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const words = cleaned.split(' ');
  words[words.length - 1] = foldWord(words[words.length - 1]!);
  return words.join(' ');
}

const UNIT_ALIASES: Record<string, string> = {
  g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', litre: 'l', litres: 'l',
  tin: 'tin', tins: 'tin',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  clove: 'clove', cloves: 'clove',
};

export function normaliseUnit(u: string | null): string | null {
  if (u === null) return null;
  const t = u.trim().toLowerCase();
  if (!t) return null;
  return UNIT_ALIASES[t] ?? t;
}

const ATTACHED_UNITS = new Set(['g', 'kg', 'ml', 'l']);

function formatQuantity(q: number): string {
  return String(Number(q.toFixed(2)));
}

/** Simple regular plural for a singular, single-word item ending in a safe consonant. */
function pluralise(item: string): string {
  const t = item.trim();
  if (/\s/.test(t) || t.toLowerCase() !== normaliseItemName(t) || !/[gnpt]$/i.test(t)) return item;
  return `${t}s`;
}

/**
 * Display text for a shopping row. `merged` rows get a simple plural when they are unit-less and the
 * quantity exceeds 1 (`3 onions`); everything else prints the item as typed.
 */
export function formatShoppingText(
  quantity: number | null,
  unit: string | null,
  item: string,
  note: string | null = null,
  merged = false,
): string {
  const suffix = note ? ` (${note})` : '';
  if (quantity === null || !(quantity > 0)) return `${item}${suffix}`;
  const q = formatQuantity(quantity);
  const u = unit?.trim() || null;
  if (u === null) {
    const shown = merged && quantity > 1 ? pluralise(item) : item;
    return `${q} ${shown}${suffix}`;
  }
  const sep = ATTACHED_UNITS.has(u.toLowerCase()) ? '' : ' ';
  return `${q}${sep}${u} ${item}${suffix}`;
}
