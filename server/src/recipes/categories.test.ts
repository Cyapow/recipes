import { describe, expect, it } from 'vitest';
import { canonicalBrand, normaliseTags, originForBrand, parseTagKey, tagKey } from './categories.js';

describe('canonicalBrand', () => {
  it('canonicalises known brands and trims others', () => {
    expect(canonicalBrand(' hello fresh ')).toBe('HelloFresh');
    expect(canonicalBrand('simplycook')).toBe('Simply Cook');
    expect(canonicalBrand('Jamie Oliver')).toBe('Jamie Oliver');
    expect(canonicalBrand('  ')).toBeNull();
    expect(canonicalBrand(null)).toBeNull();
  });
  it('maps brand to origin', () => {
    expect(originForBrand('Mine')).toBe('mine');
    expect(originForBrand('Gousto')).toBe('other');
    expect(originForBrand(null)).toBe('other');
  });
});

describe('normaliseTags', () => {
  it('wraps strings, validates, trims and dedupes', () => {
    expect(
      normaliseTags([
        'Pasta',
        { group: 'cuisine', name: ' Thai ' },
        { group: 'cuisine', name: 'thai' },
        { group: 'bogus', name: 'x' },
        { group: 'meal', name: '' },
      ]),
    ).toEqual([
      { group: 'other', name: 'Pasta' },
      { group: 'cuisine', name: 'Thai' },
    ]);
    expect(normaliseTags('nope')).toEqual([]);
  });
});

describe('tag keys', () => {
  it('splits on the first colon only', () => {
    expect(parseTagKey('other:Middle Eastern: spicy')).toEqual({ group: 'other', name: 'Middle Eastern: spicy' });
    expect(parseTagKey('nope:x')).toBeNull();
    expect(tagKey({ group: 'meal', name: 'Dinner' })).toBe('meal:Dinner');
  });
});
