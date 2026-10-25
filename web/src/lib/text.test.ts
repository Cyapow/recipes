import { describe, expect, it } from 'vitest';
import { formatAmount, formatIngredientLine, formatIngredients, parseIngredients } from './text';

const ing = (quantity: number | null, unit: string | null, item: string, note: string | null = null) =>
  ({ group: null, quantity, unit, item, note });

describe('quantity spacing', () => {
  it.each([
    [ing(500, 'g', 'beef mince'), '500g beef mince'],
    [ing(1.5, 'kg', 'potatoes'), '1.5kg potatoes'],
    [ing(250, 'ml', 'milk'), '250ml milk'],
    [ing(2, 'l', 'stock'), '2l stock'],
    [ing(2, 'tins', 'chopped tomatoes'), '2 tins chopped tomatoes'],
    [ing(3, 'tbsp', 'olive oil'), '3 tbsp olive oil'],
    [ing(1, 'tsp', 'salt', 'flaky'), '1 tsp salt (flaky)'],
    [ing(2, null, 'eggs'), '2 eggs'],
  ])('formats %j', (i, text) => expect(formatIngredientLine(i)).toBe(text));

  it('formatAmount gives quantity and unit only', () => {
    expect(formatAmount(ing(500, 'g', 'x'))).toBe('500g');
    expect(formatAmount(ing(2, 'tins', 'x'))).toBe('2 tins');
    expect(formatAmount(ing(null, null, 'x'))).toBe('');
  });
});

describe('ingredient text round trip', () => {
  it('parses attached and spaced compact units identically', () => {
    expect(parseIngredients('500g beef mince')).toEqual(parseIngredients('500 g beef mince'));
    expect(parseIngredients('500g beef mince')[0]).toMatchObject({ quantity: 500, unit: 'g', item: 'beef mince' });
    expect(parseIngredients('1.5kg potatoes')[0]).toMatchObject({ quantity: 1.5, unit: 'kg', item: 'potatoes' });
  });
  it('does not treat a bare number-letter word as a unit', () => {
    expect(parseIngredients('2glasses wine')[0]).toMatchObject({ quantity: null, item: '2glasses wine' });
  });
  it('is stable through format -> parse -> format', () => {
    const text = '# Sauce\n500g beef mince\n2 tins chopped tomatoes\n3 tbsp olive oil (good)\n250ml milk\n1/2 tsp salt';
    const once = formatIngredients(parseIngredients(text));
    expect(once).toBe(text.replace('1/2 tsp', '0.5 tsp'));
    expect(formatIngredients(parseIngredients(once))).toBe(once);
    expect(formatIngredients(parseIngredients('500 g beef mince'))).toBe('500g beef mince');
  });
});
