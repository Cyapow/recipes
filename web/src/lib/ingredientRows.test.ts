import { describe, expect, it } from 'vitest';
import { ingredientIndexes, toIngredients, toRows } from './ingredientRows';
import type { Ingredient } from '../../../server/src/recipes/schema';

const ing = (item: string, group: string | null = null): Ingredient =>
  ({ group, quantity: 1, unit: null, item, note: null });

describe('toRows', () => {
  it('puts a heading row where the group changes', () => {
    const rows = toRows([ing('beef', 'Filling'), ing('onion', 'Filling'), ing('cream', 'Topping')]);
    expect(rows.map((r) => (r.kind === 'heading' ? `# ${r.text}` : r.value.item)))
      .toEqual(['# Filling', 'beef', 'onion', '# Topping', 'cream']);
  });
  it('starts without a heading when the first ingredients have none', () => {
    const rows = toRows([ing('beef'), ing('cream', 'Topping')]);
    expect(rows.map((r) => r.kind)).toEqual(['ingredient', 'heading', 'ingredient']);
  });
  it('gives every row its own identity, so a row keeps its place while you type', () => {
    const rows = toRows([ing('beef'), ing('onion')]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });
});

describe('toIngredients', () => {
  it('hands each ingredient the heading it sits under', () => {
    const back = toIngredients(toRows([ing('beef', 'Filling'), ing('cream', 'Topping')]));
    expect(back.map((i) => [i.item, i.group])).toEqual([['beef', 'Filling'], ['cream', 'Topping']]);
  });
  it('drops a heading with nothing under it, which a recipe cannot hold', () => {
    const rows = [...toRows([ing('beef')]), { kind: 'heading' as const, id: 'x', text: 'Topping' }];
    expect(toIngredients(rows)).toEqual([ing('beef')]);
  });
  it('treats a blank heading as no heading at all', () => {
    const rows = [
      { kind: 'heading' as const, id: 'x', text: '   ' },
      { kind: 'ingredient' as const, id: 'y', value: ing('beef', 'old') },
    ];
    expect(toIngredients(rows).map((i) => i.group)).toEqual([null]);
  });
});

describe('ingredientIndexes', () => {
  it('counts only the ingredient rows, since headings are not linked to', () => {
    expect(ingredientIndexes(toRows([ing('beef', 'A'), ing('onion', 'A'), ing('cream', 'B')])))
      .toEqual([null, 0, 1, null, 2]);
  });
});
