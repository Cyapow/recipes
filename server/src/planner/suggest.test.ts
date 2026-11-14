import { describe, it, expect } from 'vitest';
import type { Ingredient } from '../recipes/schema.js';
import { buildBasket, suggest, type PlannerRecipe, type PriceMap } from './suggest.js';

const ing = (item: string): Ingredient => ({ group: null, quantity: 1, unit: null, item, note: null });
const recipe = (id: string, ...items: string[]): PlannerRecipe => ({ id, title: id.toUpperCase(), ingredients: items.map(ing) });
const prices: PriceMap = new Map([
  ['carrot', { pricePence: 80, clubcardPence: null }],
  ['onion', { pricePence: 100, clubcardPence: 70 }],
  ['beef mince', { pricePence: 400, clubcardPence: null }],
]);

describe('buildBasket', () => {
  it('buys an ingredient two recipes share only once', () => {
    const b = buildBasket([recipe('a', 'carrots', 'onion'), recipe('b', 'Carrot', 'beef mince')], prices);
    expect(b.items.map((i) => i.item)).toEqual(['beef mince', 'carrots', 'onion']);
    expect(b.items.find((i) => i.key === 'carrot')!.usedBy).toEqual(['A', 'B']);
    expect(b.totalPence).toBe(80 + 70 + 400); // onion at its Clubcard price
  });

  it('lists unpriced items instead of guessing, and ignores cupboard staples', () => {
    const b = buildBasket([recipe('a', 'carrot', 'saffron', 'salt', 'olive oil')], prices);
    expect(b.unpriced).toEqual(['saffron']);
    expect(b.totalPence).toBe(80);
    expect(b.items.map((i) => i.key)).toEqual(['carrot', 'saffron']);
  });
});

describe('suggest', () => {
  const all = [
    recipe('soup', 'carrot', 'onion', 'stock'),
    recipe('stew', 'carrot', 'onion', 'beef mince', 'potato'),
    recipe('cake', 'flour', 'eggs'),
    recipe('curry', 'onion', 'chicken', 'rice', 'tomato', 'cumin'),
  ];

  it('ranks by fewest extra ingredients, leaves out recipes that share nothing and the picked ones', () => {
    const out = suggest([recipe('base', 'carrot', 'onion')], all, prices);
    expect(out.map((s) => s.id)).toEqual(['soup', 'stew', 'curry']);
    expect(out[0]).toMatchObject({ shared: ['carrot', 'onion'], extra: ['stock'], unpricedExtra: ['stock'], extraPence: 0 });
    expect(out[1]).toMatchObject({ extra: ['beef mince', 'potato'], extraPence: 400, unpricedExtra: ['potato'] });
  });

  it('does not suggest a recipe that is already picked', () => {
    const out = suggest([all[0]!], all, prices);
    expect(out.map((s) => s.id)).not.toContain('soup');
  });

  it('prefers more shared ingredients when the extras tie', () => {
    const out = suggest(
      [recipe('base', 'a', 'b', 'c')],
      [recipe('x', 'a', 'z'), recipe('y', 'a', 'b', 'q')],
      new Map(),
    );
    expect(out.map((s) => s.id)).toEqual(['y', 'x']);
  });
});
