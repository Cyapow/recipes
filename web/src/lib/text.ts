import { DECIMAL_UNITS, FRACTION_GLYPHS } from '../../../server/src/recipes/amount';
import type { Ingredient } from '../../../server/src/recipes/schema';

const ATTACHED_UNITS = new Set(['g', 'kg', 'ml', 'l']);

// "500g", "1.5kg" (compact units attach to the number) but "2 tins", "3 tbsp".
function amount(qty: string | null, unit: string | null): string {
  if (qty != null && unit != null && ATTACHED_UNITS.has(unit.toLowerCase())) return `${qty}${unit}`;
  return [qty, unit].filter(Boolean).join(' ');
}

function joinIngredient(i: Ingredient, qty: string | null): string {
  return [amount(qty, i.unit), i.item].filter(Boolean).join(' ') + (i.note ? ` (${i.note})` : '');
}

/** Quantity and unit only, e.g. "500g" or "2 tins" (empty string when neither is set). */
export function formatAmount(i: Pick<Ingredient, 'quantity' | 'unit'>): string {
  return amount(i.quantity != null ? formatIngredientQuantity(i.quantity, i.unit) : null, i.unit);
}

export const parseLines = (text: string): string[] =>
  text.split('\n').map((s) => s.trim()).filter(Boolean);

export const parseTags = (text: string): string[] =>
  text.split(',').map((s) => s.trim()).filter(Boolean);

export function formatMinutes(total: number | null | undefined): string | null {
  if (!total || total <= 0) return null;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return [h ? `${h}h` : null, m ? `${m}m` : null].filter(Boolean).join(' ');
}

export function originLabel(r: { origin: 'mine' | 'other'; sourceName: string | null }): string {
  return r.origin === 'mine' ? 'Mine' : (r.sourceName ?? 'From elsewhere');
}

/**
 * A quantity the way a recipe writes it: "1⅔", not "1.67". Recipes are written in thirds and quarters, and a
 * decimal is both harder to read and, for a third, not even the number meant. Only a value that really is one of
 * these fractions is written as one — 0.3 stays 0.3, since someone who typed it meant it.
 */
export function formatQuantity(q: number): string {
  return String(Math.round(q * 100) / 100);
}

/**
 * An ingredient's amount the way a recipe writes it: "1⅔ tsp", not "1.67 tsp". Recipes are written in thirds and
 * quarters, and for a third the decimal is not even the number meant. Metric weights and volumes keep decimals,
 * since those are written "1.5kg", and only a value that really is one of these fractions becomes one — 0.3 stays
 * 0.3, because whoever typed it meant it. Servings are counted, not measured, so they use formatQuantity.
 */
export function formatIngredientQuantity(q: number, unit: string | null): string {
  if (!DECIMAL_UNITS.has((unit ?? '').trim().toLowerCase())) {
    const whole = Math.floor(q);
    const match = FRACTION_GLYPHS.find(([value]) => Math.abs(q - whole - value) < 0.002);
    if (match && q > 0) return `${whole || ''}${match[1]}`;
  }
  return formatQuantity(q);
}

export function formatIngredientLine(i: Ingredient): string {
  return joinIngredient(i, i.quantity != null ? formatIngredientQuantity(i.quantity, i.unit) : null);
}
