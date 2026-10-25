import type { Ingredient } from '../../../server/src/recipes/schema';

const UNITS = new Set([
  'tsp', 'tbsp', 'teaspoon', 'teaspoons', 'tablespoon', 'tablespoons', 'cup', 'cups',
  'g', 'kg', 'mg', 'ml', 'l', 'litre', 'litres', 'liter', 'liters', 'oz', 'lb', 'lbs',
  'pinch', 'pinches', 'clove', 'cloves', 'tin', 'tins', 'can', 'cans', 'slice', 'slices',
  'bunch', 'bunches', 'handful', 'handfuls', 'stick', 'sticks', 'sprig', 'sprigs',
]);

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
    const q = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)\s+(.+)$/.exec(rest);
    if (q) {
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
    const parts = [i.quantity != null ? String(i.quantity) : null, i.unit, i.item].filter(Boolean);
    lines.push(parts.join(' ') + (i.note ? ` (${i.note})` : ''));
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
