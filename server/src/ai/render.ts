import type { Ingredient, RecipeInput } from '../recipes/schema.js';

/**
 * One named field: a quoted string, a bare number, or `-` when it is not set. The prompt names this notation.
 * A line break inside a value becomes a `\n` escape (a step is typed in a textarea, so it may hold one), which
 * keeps "one numbered line" true of the rendered recipe while still telling the model the break was there.
 */
export function field(name: string, value: string | number | null): string {
  if (value == null) return `${name}=-`;
  if (typeof value === 'number') return `${name}=${value}`;
  return `${name}="${value.replace(/[\\"]/g, '\\$&').replace(/\r\n|[\r\n]/g, '\\n')}"`;
}

/**
 * One ingredient as its five separate fields, never flattened into prose. "tablespoons neutral oil (2 or 3)"
 * reads as an amount the model can tidy, and a model asked to return it unchanged would plausibly return
 * `quantity: 2, unit: 'tablespoons', item: 'neutral oil'` — exactly the rewrite applyRevision refuses to make
 * by keeping `repairAmount` away from a revision. Given the fields apart, there is nothing to re-split.
 */
export function renderIngredient(i: Ingredient): string {
  return [field('group', i.group), field('quantity', i.quantity), field('unit', i.unit), field('item', i.item), field('note', i.note)].join(' ');
}

/** The recipe as readable text, ingredients and steps each numbered from 0 so that links and `from` can refer to them. */
export function renderRecipe(r: RecipeInput): string {
  const lines: string[] = [`Title: ${r.title}`];
  if (r.description) lines.push(`Description: ${r.description}`);
  if (r.servings != null) lines.push(`Servings: ${r.servings}`);
  if (r.prepMinutes != null) lines.push(`Prep minutes: ${r.prepMinutes}`);
  if (r.cookMinutes != null) lines.push(`Cook minutes: ${r.cookMinutes}`);
  if (r.brand) lines.push(`Brand: ${r.brand}`);
  if (r.sourceName) lines.push(`Source: ${r.sourceName}`);
  if (r.sourceUrl) lines.push(`Source URL: ${r.sourceUrl}`);
  if (r.tags.length) lines.push(`Tags: ${r.tags.map((t) => `${t.group}: ${t.name}`).join('; ')}`);
  lines.push('', 'Ingredients:');
  r.ingredients.forEach((i, n) => lines.push(`${n}. ${renderIngredient(i)}`));
  lines.push('', 'Steps:');
  r.steps.forEach((s, n) => lines.push(`${n}. ingredients=[${s.ingredients.join(', ')}] ${field('text', s.text)}`));
  if (r.notes) lines.push('', `Notes: ${r.notes}`);
  return lines.join('\n');
}
