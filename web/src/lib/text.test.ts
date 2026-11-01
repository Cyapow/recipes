import { describe, expect, it } from 'vitest';
import { formatAmount, formatIngredientLine, formatItem, formatLine, formatQuantity } from './text';
import { splitAmount } from '../../../server/src/recipes/amount';

const ing = (quantity: number | null, unit: string | null, item: string, note: string | null = null) =>
  ({ group: null, quantity, unit, item, note });

describe('quantity spacing', () => {
  it.each([
    [ing(500, 'g', 'beef mince'), '500g Beef mince'],
    [ing(1.5, 'kg', 'potatoes'), '1.5kg Potatoes'],
    [ing(250, 'ml', 'milk'), '250ml Milk'],
    [ing(2, 'l', 'stock'), '2l Stock'],
    [ing(2, 'tins', 'chopped tomatoes'), '2 tins Chopped tomatoes'],
    [ing(3, 'tbsp', 'olive oil'), '3 tbsp Olive oil'],
    [ing(1, 'tsp', 'salt', 'flaky'), '1 tsp Salt (flaky)'],
    [ing(2, null, 'eggs'), '2 Eggs'],
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

describe('capitalising an ingredient', () => {
  const line = (item: string, note: string | null = null) =>
    formatIngredientLine({ group: null, quantity: 1, unit: 'tsp', item, note });
  it('starts the name with a capital', () => {
    expect(line('ground beef')).toBe('1 tsp Ground beef');
    expect(formatItem('olive oil')).toBe('Olive oil');
  });
  it('capitalises the first word only, leaving the rest as written', () => {
    expect(formatItem('extra virgin olive oil')).toBe('Extra virgin olive oil');
    expect(formatItem('Tesco Finest diced beef')).toBe('Tesco Finest diced beef');
    expect(formatItem('pak choi')).toBe('Pak choi');
  });
  it('leaves a name that does not start with a letter alone', () => {
    expect(formatItem('400g packs beef')).toBe('400g packs beef');
    expect(formatItem('')).toBe('');
  });
  it('does not touch the note', () => {
    expect(line('beef mince', 'thinly sliced')).toBe('1 tsp Beef mince (thinly sliced)');
  });
});

describe('formatLine', () => {
  it('capitalises the ingredient in a written line, not its amount', () => {
    expect(formatLine('500g beef mince')).toBe('500g Beef mince');
    expect(formatLine('2 tbsp olive oil')).toBe('2 tbsp Olive oil');
    expect(formatLine('milk')).toBe('Milk');
  });
  it('leaves a line it cannot read alone, apart from its first letter', () => {
    expect(formatLine('salt and pepper to taste')).toBe('Salt and pepper to taste');
    expect(formatLine('')).toBe('');
  });
});
