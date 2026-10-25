import { describe, it, expect } from 'vitest';
import { formatShoppingText, normaliseItemName, normaliseUnit } from './normalise.js';

describe('normaliseItemName', () => {
  it('lowercases, trims, collapses whitespace and strips edge punctuation', () => {
    expect(normaliseItemName('  Beef   Mince, ')).toBe('beef mince');
    expect(normaliseItemName('(Olive Oil).')).toBe('olive oil');
  });
  it('folds conservative plurals', () => {
    const pairs: [string, string][] = [
      ['onions', 'onion'], ['tomatoes', 'tomato'], ['potatoes', 'potato'], ['berries', 'berry'],
      ['peppers', 'pepper'], ['carrots', 'carrot'], ['chopped tomatoes', 'chopped tomato'],
    ];
    for (const [a, b] of pairs) expect(normaliseItemName(a)).toBe(b);
  });
  it('folds only the last word', () => {
    expect(normaliseItemName('Brussels Sprouts')).toBe('brussels sprout');
  });
  it('never folds protected or ss/us/is words', () => {
    for (const w of ['hummus', 'couscous', 'asparagus', 'molasses', 'swiss', 'cress', 'watercress', 'lentils', 'peas', 'oats', 'greens', 'grits', 'brussels', 'citrus', 'analysis', 'gas'])
      expect(normaliseItemName(w)).toBe(w);
  });
});

describe('normaliseUnit', () => {
  it('maps spellings to canonical forms', () => {
    expect(normaliseUnit('Grams')).toBe('g');
    expect(normaliseUnit('gram')).toBe('g');
    expect(normaliseUnit('litres')).toBe('l');
    expect(normaliseUnit('tins')).toBe('tin');
    expect(normaliseUnit('Tablespoons')).toBe('tbsp');
    expect(normaliseUnit('teaspoon')).toBe('tsp');
    expect(normaliseUnit('cloves')).toBe('clove');
    expect(normaliseUnit(' Pinch ')).toBe('pinch');
    expect(normaliseUnit('kg')).toBe('kg');
    expect(normaliseUnit('ml')).toBe('ml');
  });
  it('treats null and blank as no unit', () => {
    expect(normaliseUnit(null)).toBeNull();
    expect(normaliseUnit('   ')).toBeNull();
  });
});

describe('formatShoppingText', () => {
  it('formats the documented examples', () => {
    expect(formatShoppingText(3, null, 'onion', null, true)).toBe('3 onions');
    expect(formatShoppingText(2, 'tins', 'chopped tomatoes')).toBe('2 tins chopped tomatoes');
    expect(formatShoppingText(500, 'g', 'beef mince')).toBe('500g beef mince');
    expect(formatShoppingText(1.5, 'tbsp', 'olive oil')).toBe('1.5 tbsp olive oil');
    expect(formatShoppingText(0.333, 'kg', 'flour')).toBe('0.33kg flour');
    expect(formatShoppingText(3, 'tbsp', 'green curry paste')).toBe('3 tbsp green curry paste');
  });
  it('prints the item text (and note) when there is no quantity', () => {
    expect(formatShoppingText(null, null, 'red wine', 'splash')).toBe('red wine (splash)');
    expect(formatShoppingText(null, null, 'salt')).toBe('salt');
  });
  it('only pluralises merged, unit-less, singular, single-word items', () => {
    expect(formatShoppingText(3, null, 'onion', null, false)).toBe('3 onion');
    expect(formatShoppingText(3, null, 'onions', null, true)).toBe('3 onions');
    expect(formatShoppingText(3, null, 'olive oil', null, true)).toBe('3 olive oil');
    expect(formatShoppingText(1, null, 'onion', null, true)).toBe('1 onion');
    expect(formatShoppingText(3, 'tin', 'onion', null, true)).toBe('3 tin onion');
    expect(formatShoppingText(3, null, 'carrot', null, true)).toBe('3 carrots');
  });
});
