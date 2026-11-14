/** "4", "800g", "1.5l"-style text for an amount counted in `unit` ('' = whole items). */
export function formatAmount(n: number, unit: string): string {
  const v = Number(n.toFixed(2));
  if (unit === '') return String(v);
  if (unit === 'g') return v >= 1000 ? `${Number((v / 1000).toFixed(2))}kg` : `${v}g`;
  if (unit === 'ml') return v >= 1000 ? `${Number((v / 1000).toFixed(2))}l` : `${v}ml`;
  return `${v} ${unit}${v === 1 ? '' : 's'}`;
}

/** The choices for "what do pack sizes count in". '' means whole items. */
export const UNIT_CHOICES: [string, string][] = [
  ['', 'whole items'], ['g', 'grams'], ['ml', 'millilitres'], ['tin', 'tins'], ['pack', 'packs'],
  ['bag', 'bags'], ['bunch', 'bunches'], ['jar', 'jars'], ['clove', 'cloves'], ['slice', 'slices'],
];
