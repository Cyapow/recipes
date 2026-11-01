import { describe, expect, it } from 'vitest';
import { formatAmount, formatIngredientLine, formatQuantity } from './text';
import { splitAmount } from '../../../server/src/recipes/amount';

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

describe('quantities as fractions', () => {
  const q = (n: number) => formatAmount({ quantity: n, unit: null });
  it('writes the amounts a recipe is written in', () => {
    expect(q(0.5)).toBe('½');
    expect(q(1 / 3)).toBe('⅓');
    expect(q(0.25)).toBe('¼');
    expect(q(0.75)).toBe('¾');
  });
  it('combines a whole number with its fraction', () => {
    expect(q(1.5)).toBe('1½');
    expect(q(1 + 2 / 3)).toBe('1⅔');
    expect(q(2.25)).toBe('2¼');
  });
  it('counts servings in decimals, since servings are counted and not measured', () => {
    expect(formatQuantity(2.5)).toBe('2.5');
  });
  it('leaves whole numbers and ordinary decimals alone', () => {
    expect(q(1)).toBe('1');
    expect(q(400)).toBe('400');
    expect(q(1.2)).toBe('1.2');
    expect(q(0.4)).toBe('0.4');
  });
  it('does not pass off a nearby decimal as a fraction', () => {
    expect(q(0.3)).toBe('0.3');
    expect(q(0.34)).toBe('0.34');
  });
  it('round trips: what it writes, the parser reads back', () => {
    for (const n of [0.5, 1 / 3, 1 + 2 / 3, 2.25, 0.125]) {
      expect(splitAmount(`${q(n)} tsp salt`).quantity).toBeCloseTo(n, 2);
    }
  });
});
