import type { RecipeInput } from '../api';
import { formatIngredientLine } from './text';

// The scalar fields in the form's reading order, with the labels the form uses.
const FIELDS: [label: string, value: (r: RecipeInput) => unknown][] = [
  ['Title', (r) => r.title],
  ['Description', (r) => r.description],
  ['Brand', (r) => r.brand],
  ['Source name', (r) => r.sourceName],
  ['Source URL', (r) => r.sourceUrl],
  ['Servings', (r) => r.servings],
  ['Prep minutes', (r) => r.prepMinutes],
  ['Cook minutes', (r) => r.cookMinutes],
  ['Notes', (r) => r.notes],
  ['Tags', (r) => r.tags.map((t) => `${t.group}:${t.name}`).sort()],
];

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** How many lines of `a` have no counterpart in `b`, counting repeats. */
function unmatched(a: string[], b: string[]): number {
  const left = new Map<string, number>();
  for (const line of b) left.set(line, (left.get(line) ?? 0) + 1);
  let n = 0;
  for (const line of a) {
    const count = left.get(line) ?? 0;
    if (count > 0) left.set(line, count - 1);
    else n += 1;
  }
  return n;
}

/**
 * What a revision changed, computed by comparing the form before and after, never from what the AI says it did.
 * `stepsFrom[i]` is the index in `before.steps` that revised step `i` came from, or null if it is new. Lines come
 * back in the form's reading order; an empty array means nothing changed.
 */
export function summariseChanges(before: RecipeInput, after: RecipeInput, stepsFrom: (number | null)[]): string[] {
  const lines: string[] = [];

  for (const [label, value] of FIELDS) {
    if (JSON.stringify(value(before)) !== JSON.stringify(value(after))) lines.push(label);
  }

  // An ingredient has no provenance, so "changed" cannot be told from "added and removed": counts only.
  const was = before.ingredients.map(formatIngredientLine);
  const now = after.ingredients.map(formatIngredientLine);
  const added = unmatched(now, was);
  const removed = unmatched(was, now);
  if (added) lines.push(`${plural(added, 'ingredient')} added`);
  if (removed) lines.push(`${plural(removed, 'ingredient')} removed`);

  // Steps are named by their new position; a removed one has none, so those are counted.
  after.steps.forEach((step, i) => {
    const from = stepsFrom[i] ?? null;
    if (from === null) lines.push(`Step ${i + 1} added`);
    else if (before.steps[from]?.text !== step.text) lines.push(`Step ${i + 1} changed`);
  });
  const kept = new Set(stepsFrom.filter((f): f is number => f !== null));
  const gone = before.steps.filter((_, i) => !kept.has(i)).length;
  if (gone) lines.push(`${plural(gone, 'step')} removed`);

  return lines;
}
