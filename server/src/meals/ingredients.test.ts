import { describe, it, expect } from 'vitest';
import type { Ingredient } from '../recipes/schema.js';
import { mergeMealIngredients } from './ingredients.js';

const ing = (item: string, quantity: number | null, unit: string | null = null, extra: Partial<Ingredient> = {}): Ingredient =>
  ({ group: null, quantity, unit, item, note: null, ...extra });
const meal = (...rs: [string, Ingredient[]][]) => mergeMealIngredients(rs.map(([title, ingredients]) => ({ title, ingredients })));

describe('mergeMealIngredients', () => {
  it('adds up amounts in the same unit and names every recipe that wants it', () => {
    const lines = meal(['Lamb', [ing('garlic', 2, 'cloves')]], ['Potatoes', [ing('garlic', 3, 'cloves')]]);
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.quantity).toBe(5);
    expect(line.text).toBe('5 cloves garlic');
    expect(line.uses.map((u) => u.recipeTitle)).toEqual(['Lamb', 'Potatoes']);
  });

  it('folds kg into g and l into ml before adding', () => {
    const line = meal(['A', [ing('potatoes', 1, 'kg')]], ['B', [ing('potatoes', 500, 'g')]])[0]!;
    expect(line.unit).toBe('g');
    expect(line.quantity).toBe(1500);
    const milk = meal(['A', [ing('milk', 1, 'l')]], ['B', [ing('milk', 200, 'ml')]])[0]!;
    expect([milk.unit, milk.quantity]).toEqual(['ml', 1200]);
  });

  it('keeps an item measured two ways as two lines under the same key', () => {
    const lines = meal(['A', [ing('flour', 200, 'g')]], ['B', [ing('flour', 2, 'tbsp')]]);
    expect(lines.filter((l) => l.key === 'flour').map((l) => [l.unit, l.quantity])).toEqual([['g', 200], ['tbsp', 2]]);
  });

  it('keeps staples, unlike the planner fold', () => {
    const keys = meal(['A', [ing('salt', 1, 'tsp'), ing('olive oil', 100, 'ml'), ing('water', 200, 'ml')]]).map((l) => l.key);
    expect(keys).toContain('salt');
    expect(keys).toContain('olive oil');
    expect(keys).toContain('water');
  });

  it('keeps each use group and note, which is what prepping needs', () => {
    const line = meal(['Lamb', [ing('shallot', 2, null, { group: 'For the sauce', note: 'finely chopped' })]])[0]!;
    expect(line.uses[0]).toMatchObject({ recipeTitle: 'Lamb', group: 'For the sauce', note: 'finely chopped' });
  });

  it('leaves a vague amount unsummed and still lists it', () => {
    const lines = meal(['A', [ing('olive oil', null, null, { note: 'a good glug' })]], ['B', [ing('olive oil', 2, 'tbsp')]]);
    const vague = lines.find((l) => l.quantity === null)!;
    expect(vague.uses).toHaveLength(1);
    expect(vague.uses[0]!.note).toBe('a good glug');
    expect(lines.find((l) => l.unit === 'tbsp')!.quantity).toBe(2);
  });

  it('gives no total when any member of a group is vague', () => {
    const line = meal(['A', [ing('olive oil', null, 'tbsp')]], ['B', [ing('olive oil', 2, 'tbsp')]])[0]!;
    expect(line.quantity).toBeNull();
    expect(line.uses).toHaveLength(2);
  });

  it('drops an ingredient with no usable key and does not crash', () => {
    const lines = meal(['A', [ing('', 1), ing('   ', 1), ing('egg', 2)]]);
    expect(lines.every((l) => l.key !== '')).toBe(true);
    expect(lines.map((l) => l.key)).toEqual(['egg']);
  });

  it('pluralises a bare count once merged', () => {
    expect(meal(['A', [ing('onion', 1)]], ['B', [ing('onion', 2)]])[0]!.text).toBe('3 onions');
  });

  it('orders lines by item name so the list reads the same every time', () => {
    const keys = meal(['A', [ing('zucchini', 1), ing('apple', 1)]], ['B', [ing('milk', 1, 'l')]]).map((l) => l.key);
    expect(keys).toEqual([...keys].sort());
  });
});
