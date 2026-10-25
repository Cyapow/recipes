import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { openDb } from '../db.js';
import type { Ingredient } from '../recipes/schema.js';
import { createShoppingRepo } from './repo.js';

const ing = (quantity: number | null, unit: string | null, item: string, note: string | null = null): Ingredient =>
  ({ group: null, quantity, unit, item, note });
const A = { id: 'a', title: 'Bolognese' };
const B = { id: 'b', title: 'Chilli' };
const make = () => createShoppingRepo(openDb(':memory:'));

describe('shopping repo', () => {
  it('merges same item and unit, summing quantities and unioning sources', () => {
    const r = make();
    r.add(A, [ing(2, 'tins', 'chopped tomatoes')]);
    r.add(B, [ing(1, 'tin', 'chopped tomatoes')]);
    const items = r.list();
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(3);
    expect(items[0]!.unit).toBe('tins');
    expect(items[0]!.text).toBe('3 tins chopped tomatoes');
    expect(items[0]!.sources).toEqual([{ recipeId: 'a', title: 'Bolognese' }, { recipeId: 'b', title: 'Chilli' }]);
  });

  it('merges count units across singular and plural spellings', () => {
    const units: [string, string][] = [
      ['bunch', 'bunches'], ['can', 'cans'], ['pack', 'packs'], ['packet', 'packets'], ['jar', 'jars'], ['bag', 'bags'],
      ['bottle', 'bottles'], ['slice', 'slices'], ['piece', 'pieces'], ['stick', 'sticks'], ['sprig', 'sprigs'],
      ['head', 'heads'], ['pinch', 'pinches'], ['clove', 'cloves'], ['tin', 'tins'],
    ];
    for (const [one, many] of units) {
      const r = make();
      r.add(A, [ing(2, one, 'thing')]);
      r.add(B, [ing(1, many, 'thing')]);
      const items = r.list();
      expect(items, one).toHaveLength(1);
      expect(items[0]!.quantity).toBe(3);
      expect(items[0]!.text).toBe(`3 ${many} thing`);
    }
  });

  it('never merges across different units', () => {
    const r = make();
    r.add(A, [ing(500, 'g', 'beef mince')]);
    r.add(B, [ing(1, 'tin', 'beef mince')]);
    expect(r.list().map((i) => i.text)).toEqual(['500g beef mince', '1 tin beef mince']);
  });

  it('never merges vague or annotated lines', () => {
    const r = make();
    r.add(A, [ing(null, null, 'red wine', 'splash')]);
    r.add(B, [ing(null, null, 'red wine', 'splash'), ing(1, null, 'salt', 'to taste')]);
    r.add({ id: 'c', title: 'C' }, [ing(2, null, 'salt', 'to taste'), ing(1, null, 'salt')]);
    expect(r.list().map((i) => i.text)).toEqual([
      'red wine (splash)', 'red wine (splash)', '1 salt (to taste)', '2 salt (to taste)', '1 salt',
    ]);
  });

  it('keeps first wording and pluralises merged unit-less items', () => {
    const r = make();
    r.add(A, [ing(3, null, 'onions')]);
    r.add(B, [ing(1, null, 'onion')]);
    expect(r.list().map((i) => i.text)).toEqual(['4 onions']);
    const r2 = make();
    r2.add(A, [ing(1, null, 'Onion')]);
    r2.add(B, [ing(2, null, 'onions')]);
    expect(r2.list().map((i) => i.text)).toEqual(['3 Onions']);
  });

  it('rounds sums to 2 decimals and ignores ingredient group', () => {
    const r = make();
    r.add(A, [{ ...ing(0.1, 'kg', 'flour'), group: 'Sauce' }]);
    r.add(B, [{ ...ing(0.2, 'kg', 'flour'), group: 'Base' }]);
    expect(r.list()).toHaveLength(1);
    expect(r.list()[0]!.quantity).toBe(0.3);
  });

  it('merges lines within one recipe', () => {
    const r = make();
    expect(r.add(A, [ing(1, 'tsp', 'salt'), ing(2, 'tsp', 'salt')])).toEqual({ added: 2 });
    expect(r.list().map((i) => i.text)).toEqual(['3 tsp salt']);
  });

  it('keeps protected words intact when merging', () => {
    const r = make();
    r.add(A, [ing(1, 'tub', 'hummus'), ing(1, 'bag', 'couscous')]);
    r.add(B, [ing(1, 'tub', 'hummus')]);
    expect(r.list().map((i) => i.text)).toEqual(['2 tub hummus', '1 bag couscous']);
  });

  it('refuses a second add of the same recipe unless forced', () => {
    const r = make();
    r.add(A, [ing(1, null, 'onion')]);
    expect(r.add(A, [ing(1, null, 'onion')])).toEqual({ alreadyOnList: true });
    expect(r.list()[0]!.quantity).toBe(1);
    expect(r.add(A, [ing(1, null, 'onion')], { force: true })).toEqual({ added: 1 });
    expect(r.list()[0]!.quantity).toBe(2);
  });

  it('allows re-adding once all of the recipe items are removed', () => {
    const r = make();
    r.add(A, [ing(1, null, 'onion'), ing(1, 'tin', 'beans')]);
    r.list().forEach((i) => expect(r.remove(i.id)).toBe(true));
    expect(r.remove('nope')).toBe(false);
    expect(r.add(A, [ing(1, null, 'onion')])).toEqual({ added: 1 });
  });

  it('clear empties the list and returns the count', () => {
    const r = make();
    r.add(A, [ing(1, null, 'onion'), ing(1, 'tin', 'beans')]);
    expect(r.clear()).toBe(2);
    expect(r.list()).toEqual([]);
    expect(r.clear()).toBe(0);
  });

  it('lists oldest first', () => {
    const r = make();
    r.add(A, [ing(1, null, 'a'), ing(1, null, 'b'), ing(1, null, 'c')]);
    expect(r.list().map((i) => i.item)).toEqual(['a', 'b', 'c']);
  });

  it('survives reopening the database', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'shop-'));
    try {
      const file = path.join(dir, 'x.db');
      const db = openDb(file);
      createShoppingRepo(db).add(A, [ing(2, 'tins', 'chopped tomatoes')]);
      db.close();
      const again = createShoppingRepo(openDb(file));
      expect(again.list().map((i) => i.text)).toEqual(['2 tins chopped tomatoes']);
      expect(again.add(A, [ing(1, null, 'x')])).toEqual({ alreadyOnList: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
