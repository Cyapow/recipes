import { describe, expect, it } from 'vitest';
import type { RecipeInput } from '../api';
import { FIELDS, summariseChanges } from './reviseSummary';

const ing = (
  item: string,
  quantity: number | null = null,
  unit: string | null = null,
  group: string | null = null,
  note: string | null = null,
) => ({ group, quantity, unit, item, note });
const step = (text: string) => ({ text, imageId: null, ingredients: [] });

const recipe: RecipeInput = {
  title: 'Soup',
  description: null,
  origin: 'mine',
  brand: null,
  sourceName: null,
  sourceUrl: null,
  servings: 4,
  prepMinutes: 10,
  cookMinutes: 30,
  ingredients: [ing('leek', 2), ing('stock', 1, 'l')],
  steps: [step('Chop the leeks.'), step('Simmer.')],
  notes: null,
  tags: [{ group: 'meal', name: 'Lunch' }],
  imageIds: [],
};

describe('summariseChanges', () => {
  it('says nothing when nothing changed', () => {
    expect(summariseChanges(recipe, recipe, [0, 1])).toEqual([]);
  });

  it('names a changed field by its label in the form', () => {
    expect(summariseChanges(recipe, { ...recipe, cookMinutes: 40 }, [0, 1])).toEqual(['Cook minutes']);
  });

  it('names an added step by its new position', () => {
    const after = { ...recipe, steps: [recipe.steps[0], step('Cool for 20 minutes.'), recipe.steps[1]] };
    expect(summariseChanges(recipe, after, [0, null, 1])).toEqual(['Step 2 added']);
  });

  it('names a reworded step by its new position', () => {
    const after = { ...recipe, steps: [recipe.steps[0], step('Simmer for 20 minutes.')] };
    expect(summariseChanges(recipe, after, [0, 1])).toEqual(['Step 2 changed']);
  });

  it('counts removed steps rather than naming a position they no longer have', () => {
    expect(summariseChanges(recipe, { ...recipe, steps: [recipe.steps[1]] }, [1])).toEqual(['1 step removed']);
    expect(summariseChanges(recipe, { ...recipe, steps: [] }, [])).toEqual(['2 steps removed']);
  });

  it('says a step that only moved did not change', () => {
    const after = { ...recipe, steps: [recipe.steps[1], recipe.steps[0]] };
    expect(summariseChanges(recipe, after, [1, 0])).toEqual([]);
  });

  it('counts ingredients added and removed', () => {
    const after = { ...recipe, ingredients: [ing('onion', 1), ing('carrot', 2), ing('garlic', 3)] };
    expect(summariseChanges(recipe, after, [0, 1])).toEqual(['3 ingredients added', '2 ingredients removed']);
    const one = { ...recipe, ingredients: [...recipe.ingredients, ing('salt')] };
    expect(summariseChanges(recipe, one, [0, 1])).toEqual(['1 ingredient added']);
  });

  it.each([
    ['group', ing('leek', 2, null, 'Veg')],
    ['item case', ing('Leek', 2)],
    ['note', ing('leek', 2, null, null, 'washed')],
    ['quantity', ing('leek', 2.001)],
  ])('reports an ingredient whose only change is its %s', (_, changed) => {
    const after = { ...recipe, ingredients: [changed, recipe.ingredients[1]] };
    expect(summariseChanges(recipe, after, [0, 1])).toEqual(['1 ingredient added', '1 ingredient removed']);
  });

  it('reports a step whose text is the same but whose ingredient links differ', () => {
    const before = { ...recipe, steps: [{ ...step('Chop the leeks.'), ingredients: [0] }, recipe.steps[1]] };
    const after = { ...before, steps: [{ ...before.steps[0], ingredients: [0, 1] }, before.steps[1]] };
    expect(summariseChanges(before, after, [0, 1])).toEqual(['Step 1 changed']);
  });

  it('reports a reordered ingredient list as reordered, not as added and removed', () => {
    const after = { ...recipe, ingredients: [...recipe.ingredients].reverse() };
    expect(summariseChanges(recipe, after, [0, 1])).toEqual(['Ingredients reordered']);
  });

  it('says nothing about the order when ingredients were added as well', () => {
    const after = { ...recipe, ingredients: [...recipe.ingredients].reverse().concat(ing('salt')) };
    expect(summariseChanges(recipe, after, [0, 1])).toEqual(['1 ingredient added']);
  });

  it('compares the brand canonicalised, so typing a known brand loosely is not a change', () => {
    const typed = { ...recipe, brand: 'Hello Fresh' };
    const returned = { ...recipe, brand: 'HelloFresh' };
    expect(summariseChanges(typed, returned, [0, 1])).toEqual([]);
    expect(summariseChanges(typed, { ...recipe, brand: 'Gousto' }, [0, 1])).toEqual(['Brand']);
  });

  it('covers every field of a recipe, so a new one cannot go unreported', () => {
    // FIELDS is hand-maintained: a field added to RecipeInput and to the form has to be added here too, or the
    // summary goes quiet about it with the suite green. ingredients and steps are compared on their own below.
    // origin and imageIds are the server's: applyRevision derives origin from the brand and returns the imageIds
    // it was given, so neither can change behind a revision and neither has a line of its own.
    const special = ['ingredients', 'steps'];
    const serverOwned = ['origin', 'imageIds'];
    const named = FIELDS.map(([key]) => key as string);
    for (const key of Object.keys(recipe)) {
      expect([...named, ...special, ...serverOwned], `${key} is not reported by the summary`).toContain(key);
    }
  });

  it('reports tags as one line however many changed', () => {
    const after = { ...recipe, tags: [...recipe.tags, { group: 'meal' as const, name: 'Dinner' }] };
    expect(summariseChanges(recipe, after, [0, 1])).toEqual(['Tags']);
  });

  it("lists several changes in the form's order", () => {
    const after = {
      ...recipe,
      title: 'Leek soup',
      ingredients: [...recipe.ingredients, ing('salt')],
      steps: [recipe.steps[0], step('Simmer for 20 minutes.')],
    };
    expect(summariseChanges(recipe, after, [0, 1])).toEqual(['Title', '1 ingredient added', 'Step 2 changed']);
  });
});
