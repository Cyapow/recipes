import type { RecipeInput } from '../api';
import { canonicalBrand } from '../../../server/src/recipes/categories';

/**
 * The scalar fields in the form's reading order, with the labels the form uses and the key each one reads. The key
 * is what lets a test check this hand-maintained list still covers every field of a RecipeInput.
 * Brand is compared canonicalised: the form sends what was typed ("Hello Fresh") and the server returns
 * canonicalBrand of it ("HelloFresh"), which would otherwise report Brand as changed by every revision.
 */
export const FIELDS: [key: keyof RecipeInput, label: string, value: (r: RecipeInput) => unknown][] = [
  ['title', 'Title', (r) => r.title],
  ['description', 'Description', (r) => r.description],
  ['brand', 'Brand', (r) => canonicalBrand(r.brand)],
  ['sourceName', 'Source name', (r) => r.sourceName],
  ['sourceUrl', 'Source URL', (r) => r.sourceUrl],
  ['servings', 'Servings', (r) => r.servings],
  ['prepMinutes', 'Prep minutes', (r) => r.prepMinutes],
  ['cookMinutes', 'Cook minutes', (r) => r.cookMinutes],
  ['notes', 'Notes', (r) => r.notes],
  ['tags', 'Tags', (r) => r.tags.map((t) => `${t.group}:${t.name}`).sort()],
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

  for (const [, label, value] of FIELDS) {
    if (JSON.stringify(value(before)) !== JSON.stringify(value(after))) lines.push(label);
  }

  // An ingredient has no provenance, so "changed" cannot be told from "added and removed": counts only.
  // Keyed on the raw fields, not a display string: formatIngredientLine drops the group, capitalises the item and
  // rounds the quantity, so any of those changing would otherwise read as "nothing changed".
  const key = (i: RecipeInput['ingredients'][number]) => JSON.stringify([i.group, i.quantity, i.unit, i.item, i.note]);
  const was = before.ingredients.map(key);
  const now = after.ingredients.map(key);
  const added = unmatched(now, was);
  const removed = unmatched(was, now);
  if (added) lines.push(`${plural(added, 'ingredient')} added`);
  if (removed) lines.push(`${plural(removed, 'ingredient')} removed`);
  // The same ingredients in a different order: nothing was added or removed, but the person is looking at a new
  // order, so the summary has to say so rather than claim nothing changed.
  if (!added && !removed && JSON.stringify(was) !== JSON.stringify(now)) lines.push('Ingredients reordered');

  // Steps are named by their new position; a removed one has none, so those are counted.
  // Photos are not compared: applyRevision gives a surviving step exactly its source step's imageId (and the recipe
  // its own imageIds, and origin follows brand), so a revision cannot change them silently. A step whose photo
  // seems to move is one stepsFrom calls new or from elsewhere, and that is already reported here.
  // The ingredient links are model-supplied, so they are compared along with the text.
  after.steps.forEach((step, i) => {
    const from = stepsFrom[i] ?? null;
    const old = from === null ? undefined : before.steps[from];
    if (from === null) lines.push(`Step ${i + 1} added`);
    else if (old?.text !== step.text || JSON.stringify(old.ingredients) !== JSON.stringify(step.ingredients)) {
      lines.push(`Step ${i + 1} changed`);
    }
  });
  const kept = new Set(stepsFrom.filter((f): f is number => f !== null));
  const gone = before.steps.filter((_, i) => !kept.has(i)).length;
  if (gone) lines.push(`${plural(gone, 'step')} removed`);

  return lines;
}
