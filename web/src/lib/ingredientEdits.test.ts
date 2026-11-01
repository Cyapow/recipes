import { describe, expect, it } from 'vitest';
import { moveIngredient, removeIngredient } from './ingredientEdits';
import type { Ingredient, Step } from '../../../server/src/recipes/schema';

const ing = (item: string): Ingredient => ({ group: null, quantity: 1, unit: null, item, note: null });
const step = (text: string, ingredients: number[]): Step => ({ text, imageId: null, ingredients });

// beef, onion, stock: step one uses the beef, step two the onion and the stock.
const list = [ing('beef'), ing('onion'), ing('stock')];
const steps = [step('Brown it.', [0]), step('Add the rest.', [1, 2])];

describe('removeIngredient', () => {
  it('drops the links to it and shifts the ones after it down', () => {
    const r = removeIngredient(list, steps, 0);
    expect(r.ingredients.map((i) => i.item)).toEqual(['onion', 'stock']);
    expect(r.steps.map((s) => s.ingredients)).toEqual([[], [0, 1]]);
  });
  it('leaves the links before it alone', () => {
    const r = removeIngredient(list, steps, 2);
    expect(r.ingredients.map((i) => i.item)).toEqual(['beef', 'onion']);
    expect(r.steps.map((s) => s.ingredients)).toEqual([[0], [1]]);
  });
  it('ignores an index that is not there', () => {
    expect(removeIngredient(list, steps, 9)).toEqual({ ingredients: list, steps });
  });
});

describe('moveIngredient', () => {
  it('follows an ingredient up the list with its links', () => {
    const r = moveIngredient(list, steps, 2, 0);
    expect(r.ingredients.map((i) => i.item)).toEqual(['stock', 'beef', 'onion']);
    // the stock is now 0, the beef 1, the onion 2
    expect(r.steps.map((s) => s.ingredients)).toEqual([[1], [0, 2]]);
  });
  it('follows one down the list', () => {
    const r = moveIngredient(list, steps, 0, 2);
    expect(r.ingredients.map((i) => i.item)).toEqual(['onion', 'stock', 'beef']);
    expect(r.steps.map((s) => s.ingredients)).toEqual([[2], [0, 1]]);
  });
  it('does nothing when the move goes nowhere or off the end', () => {
    for (const [from, to] of [[1, 1], [0, -1], [2, 3], [5, 0]]) {
      expect(moveIngredient(list, steps, from!, to!)).toEqual({ ingredients: list, steps });
    }
  });
  it('keeps each step\'s links in order', () => {
    const r = moveIngredient(list, steps, 1, 2);
    expect(r.steps[1]!.ingredients).toEqual([1, 2]);
  });
});
