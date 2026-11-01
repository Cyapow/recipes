import { describe, expect, it } from 'vitest';
import { canonicalUnit, splitAmount } from './amount.js';

const q = (line: string) => {
  const { quantity, unit, item } = splitAmount(line);
  return { quantity, unit, item };
};

describe('splitAmount', () => {
  it('splits the plain shapes', () => {
    expect(q('500g beef mince')).toEqual({ quantity: 500, unit: 'g', item: 'beef mince' });
    expect(q('500 g beef mince')).toEqual({ quantity: 500, unit: 'g', item: 'beef mince' });
    expect(q('2 tins chopped tomatoes')).toEqual({ quantity: 2, unit: 'tins', item: 'chopped tomatoes' });
    expect(q('3 tbsp olive oil')).toEqual({ quantity: 3, unit: 'tbsp', item: 'olive oil' });
    expect(q('2 eggs')).toEqual({ quantity: 2, unit: null, item: 'eggs' });
  });
  it('reads the imperial units an American recipe uses', () => {
    expect(q('1 lb ground beef')).toEqual({ quantity: 1, unit: 'lb', item: 'ground beef' });
    expect(q('8 oz cream cheese')).toEqual({ quantity: 8, unit: 'oz', item: 'cream cheese' });
    expect(q('2 pounds chicken thighs')).toEqual({ quantity: 2, unit: 'pounds', item: 'chicken thighs' });
    expect(q('4 fl oz double cream')).toEqual({ quantity: 4, unit: 'fl oz', item: 'double cream' });
  });
  it('reads the fraction characters those recipes are written in', () => {
    expect(q('1½ tbsp olive oil')).toEqual({ quantity: 1.5, unit: 'tbsp', item: 'olive oil' });
    expect(q('⅓ tsp black pepper')).toEqual({ quantity: 0.33, unit: 'tsp', item: 'black pepper' });
    expect(q('1 ½ lb beef')).toEqual({ quantity: 1.5, unit: 'lb', item: 'beef' });
    expect(q('¾ cup milk')).toEqual({ quantity: 0.75, unit: 'cup', item: 'milk' });
    expect(q('1/2 tsp salt')).toEqual({ quantity: 0.5, unit: 'tsp', item: 'salt' });
    expect(q('1 1/2 cups flour')).toEqual({ quantity: 1.5, unit: 'cups', item: 'flour' });
  });
  it('leaves a line it cannot read whole, rather than stranding the unit', () => {
    expect(q('large flour tortillas')).toEqual({ quantity: null, unit: null, item: 'large flour tortillas' });
    expect(q('2glasses wine')).toEqual({ quantity: null, unit: null, item: '2glasses wine' });
    expect(q('salt and pepper to taste')).toEqual({ quantity: null, unit: null, item: 'salt and pepper to taste' });
  });
  it('keeps a unit only when something is left to call the item', () => {
    expect(q('2 cups')).toEqual({ quantity: 2, unit: null, item: 'cups' });
  });
  it('takes a trailing parenthesis as the note', () => {
    expect(splitAmount('3 tbsp olive oil (good stuff)')).toEqual({ quantity: 3, unit: 'tbsp', item: 'olive oil', note: 'good stuff' });
    expect(splitAmount('(optional) sprinkles')).toMatchObject({ note: null, item: '(optional) sprinkles' });
  });
});

describe('canonicalUnit', () => {
  it('settles the spellings one recipe can arrive with', () => {
    for (const u of ['teaspoon', 'teaspoons', 'TSP', 'tsp.']) expect(canonicalUnit(u)).toBe('tsp');
    for (const u of ['tablespoon', 'Tablespoons', 'tbsp']) expect(canonicalUnit(u)).toBe('tbsp');
    expect(canonicalUnit('cloves')).toBe('clove');
    expect(canonicalUnit('pounds')).toBe('lb');
    expect(canonicalUnit('litres')).toBe('l');
  });
  it('keeps a unit it does not know rather than dropping it', () => {
    expect(canonicalUnit('packs')).toBe('packs');
    expect(canonicalUnit('  ')).toBeNull();
    expect(canonicalUnit(null)).toBeNull();
  });
});

describe('splitAmount with a range', () => {
  it('takes the lower end as the quantity and keeps the range in the note', () => {
    expect(splitAmount('2-3 tablespoons neutral oil'))
      .toEqual({ quantity: 2, unit: 'tablespoons', item: 'neutral oil', note: '2-3 tablespoons' });
    expect(splitAmount('1–1½ lb beef'))
      .toEqual({ quantity: 1, unit: 'lb', item: 'beef', note: '1–1½ lb' });
    expect(splitAmount('2 to 3 tsp salt'))
      .toEqual({ quantity: 2, unit: 'tsp', item: 'salt', note: '2 to 3 tsp' });
  });
  it('leaves a note that is already there, which usually says it better', () => {
    expect(splitAmount('2-3 tbsp oil (to taste)'))
      .toEqual({ quantity: 2, unit: 'tbsp', item: 'oil', note: 'to taste' });
  });
  it('is not fooled by a number that is not a range', () => {
    expect(splitAmount('1 lb ground beef')).toMatchObject({ quantity: 1, note: null });
    expect(splitAmount('9-inch pie crust')).toMatchObject({ quantity: null, item: '9-inch pie crust' });
  });
});
