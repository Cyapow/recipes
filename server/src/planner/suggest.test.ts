import { describe, it, expect } from 'vitest';
import type { Ingredient } from '../recipes/schema.js';
import { buildBasket, choosePacks, suggest, type Pack, type PlannerRecipe, type PricingMap } from './suggest.js';

const ing = (item: string, quantity: number | null = 1, unit: string | null = null): Ingredient =>
  ({ group: null, quantity, unit, item, note: null });
const recipe = (id: string, ...lines: (string | Ingredient)[]): PlannerRecipe => ({
  id, title: id.toUpperCase(), ingredients: lines.map((l) => (typeof l === 'string' ? ing(l) : l)),
});
const pack = (label: string, amount: number | null, pricePence: number, clubcardPence: number | null = null): Pack =>
  ({ label, amount, pricePence, clubcardPence });

const ONIONS = [pack('loose', 1, 30), pack('bag of 3', 3, 80)];

describe('choosePacks', () => {
  it('picks the cheapest combination, mixing pack sizes', () => {
    const names = (n: number) => choosePacks(n, ONIONS)!.picks.map((p) => `${p.count}x${p.label}`);
    expect(names(2)).toEqual(['2xloose']); // 60p beats the 80p bag
    expect(names(3)).toEqual(['1xbag of 3']);
    expect(names(4)).toEqual(['1xloose', '1xbag of 3']); // 110p
    expect(names(6)).toEqual(['2xbag of 3']);
    expect(choosePacks(4, ONIONS)!.totalPence).toBe(110);
  });

  it('may buy more than needed when that is cheaper, and says how much is left over', () => {
    const c = choosePacks(2, [pack('loose', 1, 50), pack('bag of 3', 3, 80)])!;
    expect(c.totalPence).toBe(80);
    expect(c.coveredAmount).toBe(3);
  });

  it('uses the Clubcard price when there is one', () => {
    expect(choosePacks(3, [pack('bag', 3, 100, 70)])!.totalPence).toBe(70);
  });

  it('handles fractional amounts', () => {
    expect(choosePacks(1.5, [pack('half', 0.5, 40), pack('whole', 1, 100)])!.totalPence).toBe(120);
  });

  it('a pack with no amount covers any need as one pack; no packs gives null', () => {
    expect(choosePacks(500, [pack('', null, 400)])!.picks).toEqual([{ label: '', count: 1, pence: 400 }]);
    expect(choosePacks(500, [])).toBeNull();
  });

  it('with nothing measurable to cover, buys one of the cheapest', () => {
    expect(choosePacks(0, ONIONS)!.totalPence).toBe(30);
  });

  it('does not freeze on a huge need', () => {
    const c = choosePacks(5_000_000, [pack('1kg', 1000, 120)])!;
    expect(c.picks[0]!.count).toBe(5000);
  });
});

describe('buildBasket', () => {
  const pricing: PricingMap = new Map([
    ['onion', { shop: null, unit: '', packs: ONIONS }],
    ['carrot', { shop: null, unit: 'g', packs: [pack('1kg bag', 1000, 90)] }],
    ['beef shin', { shop: 'Butcher', unit: 'g', packs: [pack('per kg', 1000, 1100)] }],
  ]);

  it('adds up what the recipes need across recipes, so a shared pack is bought once', () => {
    const b = buildBasket(
      [recipe('a', ing('onion', 2), ing('carrot', 300, 'g')), recipe('b', ing('onions', 2), ing('carrot', 0.5, 'kg'))],
      pricing,
    );
    const onion = b.items.find((i) => i.key === 'onion')!;
    expect(onion).toMatchObject({ needed: 4, pricePence: 110, leftover: 0, unclear: false, usedBy: ['A', 'B'] });
    const carrot = b.items.find((i) => i.key === 'carrot')!;
    expect(carrot).toMatchObject({ needed: 800, pricePence: 90, leftover: 200 });
    expect(b.totalPence).toBe(200);
  });

  it('flags use it cannot measure instead of guessing', () => {
    const b = buildBasket([recipe('a', ing('onion', 1, 'large'), ing('carrot', null, null))], pricing);
    expect(b.items.find((i) => i.key === 'onion')).toMatchObject({ unclear: true, needed: 0, pricePence: 30 });
    expect(b.items.find((i) => i.key === 'carrot')!.unclear).toBe(true);
  });

  it('groups totals by shop and lists unpriced items without guessing', () => {
    const b = buildBasket([recipe('a', ing('beef shin', 600, 'g'), ing('onion', 1), ing('saffron'), 'salt')], pricing);
    expect(b.byShop).toEqual([{ shop: 'Butcher', totalPence: 1100 }, { shop: null, totalPence: 30 }]);
    expect(b.unpriced).toEqual(['saffron']);
    expect(b.items.map((i) => i.key)).not.toContain('salt');
  });
});

describe('suggest', () => {
  const pricing: PricingMap = new Map([
    ['carrot', { shop: null, unit: '', packs: [pack('each', 1, 20), pack('bag of 4', 4, 60)] }],
    ['onion', { shop: null, unit: '', packs: ONIONS }],
    ['beef mince', { shop: 'Butcher', unit: '', packs: [pack('', null, 400)] }],
  ]);
  const all = [
    recipe('soup', 'carrot', 'onion', 'stock'),
    recipe('stew', 'carrot', 'onion', 'beef mince', 'potato'),
    recipe('cake', 'flour', 'eggs'),
    recipe('curry', 'onion', 'chicken', 'rice', 'tomato', 'cumin'),
  ];

  it('ranks by fewest extra ingredients and leaves out recipes sharing nothing', () => {
    const out = suggest([recipe('base', 'carrot', 'onion')], all, pricing);
    expect(out.map((s) => s.id)).toEqual(['soup', 'stew', 'curry']);
    expect(out[0]).toMatchObject({ shared: ['carrot', 'onion'], extra: [{ item: 'stock', shop: null }], unpricedExtra: ['stock'], extraPence: 50 }); // its own carrot (+20p) and onion (+30p)
    expect(out[1]!.extra).toEqual([{ item: 'beef mince', shop: 'Butcher' }, { item: 'potato', shop: null }]);
    expect(out[1]!.extraPence).toBe(450);
  });

  it('prices a recipe by what it adds on top, so spare packs are free', () => {
    // 1 carrot costs 20p. Adding a recipe with 3 more makes 4 carrots, which is one 60p bag: +40p, not +60p.
    const out = suggest([recipe('base', 'carrot')], [recipe('big', ing('carrot', 3), 'leek')], pricing);
    expect(out[0]!.extraPence).toBe(40);
  });

  it('never suggests a recipe that is already picked', () => {
    expect(suggest([all[0]!], all, pricing).map((s) => s.id)).not.toContain('soup');
  });

  it('prefers more shared ingredients when the extras tie', () => {
    const out = suggest([recipe('base', 'a', 'b', 'c')], [recipe('x', 'a', 'z'), recipe('y', 'a', 'b', 'q')], new Map());
    expect(out.map((s) => s.id)).toEqual(['y', 'x']);
  });
});
