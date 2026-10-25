import type { Ingredient } from '../../../server/src/recipes/schema';

const UNITS = new Set([
  'tsp', 'tbsp', 'teaspoon', 'teaspoons', 'tablespoon', 'tablespoons', 'cup', 'cups',
  'g', 'kg', 'mg', 'ml', 'l', 'litre', 'litres', 'liter', 'liters', 'oz', 'lb', 'lbs',
  'pinch', 'pinches', 'clove', 'cloves', 'tin', 'tins', 'can', 'cans', 'slice', 'slices',
  'bunch', 'bunches', 'handful', 'handfuls', 'stick', 'sticks', 'sprig', 'sprigs',
]);

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
  return amount(i.quantity != null ? formatQuantity(i.quantity) : null, i.unit);
}

function parseQuantity(s: string): number | null {
  const m = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[1] ?? 0) + Number(m[2]) / Number(m[3]);
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

export function parseIngredients(text: string): Ingredient[] {
  const out: Ingredient[] = [];
  let group: string | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      group = line.replace(/^#+\s*/, '') || null;
      continue;
    }
    let rest = line;
    let note: string | null = null;
    const n = /\s*\(([^()]*)\)\s*$/.exec(rest);
    if (n && n.index > 0) {
      note = n[1].trim() || null;
      rest = rest.slice(0, n.index);
    }
    let quantity: number | null = null;
    let unit: string | null = null;
    const att = /^(\d+(?:\.\d+)?)(g|kg|ml|l)\s+(.+)$/i.exec(rest);
    const q = att ? null : /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s+(.+)$/.exec(rest);
    if (att) {
      quantity = Number(att[1]);
      unit = att[2];
      rest = att[3];
    } else if (q) {
      quantity = parseQuantity(q[1]);
      rest = q[2];
      const [first, ...others] = rest.split(/\s+/);
      if (others.length > 0 && UNITS.has(first.toLowerCase())) {
        unit = first;
        rest = others.join(' ');
      }
    }
    out.push({ group, quantity, unit, item: rest, note });
  }
  return out;
}

export function formatIngredients(list: Ingredient[]): string {
  const lines: string[] = [];
  let group: string | null = null;
  for (const i of list) {
    if (i.group !== group) {
      lines.push(i.group ? `# ${i.group}` : '#');
      group = i.group;
    }
    lines.push(joinIngredient(i, i.quantity != null ? String(i.quantity) : null));
  }
  return lines.join('\n');
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

export function formatQuantity(q: number): string {
  return String(Math.round(q * 100) / 100);
}

export function formatIngredientLine(i: Ingredient): string {
  return joinIngredient(i, i.quantity != null ? formatQuantity(i.quantity) : null);
}
