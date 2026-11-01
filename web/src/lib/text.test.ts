import { describe, expect, it } from 'vitest';
import { formatAmount, formatIngredientLine } from './text';

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
