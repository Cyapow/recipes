import { describe, expect, it } from 'vitest';
import { linkIngredients } from './links.js';
import { foldPlural } from './words.js';

const ing = (item: string) => ({ group: null, quantity: null, unit: null, item, note: null });
const list = ['500g beef mince', '2 tins chopped tomatoes', '1 onion', '1 carrot', 'olive oil'].map(ing);

describe('linkIngredients', () => {
  it('needs ALL significant words: "beef mince" links, bare "mince" does not', () => {
    expect(linkIngredients('Brown the beef mince', list)).toEqual([0]);
    expect(linkIngredients('Brown the mince hard', list)).toEqual([]);
  });
  it('ignores units and descriptors, folds plurals', () => {
    expect(linkIngredients('Add the tomatoes and simmer', list)).toEqual([1]);
    expect(linkIngredients('Add the Onions', list)).toEqual([2]);
  });
  it('olive oil needs both words; unrelated steps link nothing', () => {
    expect(linkIngredients('add oil', list)).toEqual([]);
    expect(linkIngredients('Add the olive oil', list)).toEqual([4]);
    expect(linkIngredients('Season the sauce', list)).toEqual([]);
  });
  it('sorted, deduped, and never links an ingredient with no significant words', () => {
    const l = ['2 tbsp', '', 'carrots', 'carrot'].map(ing);
    expect(linkIngredients('Slice the carrots and 2 tbsp', l)).toEqual([2, 3]);
  });
  it('whole words only', () => {
    expect(linkIngredients('Add the onionskin', list)).toEqual([]);
  });
});

describe('foldPlural', () => {
  it('folds regular plurals', () => {
    expect([foldPlural('onions'), foldPlural('tomatoes'), foldPlural('berries'), foldPlural('peaches')]).toEqual(['onion', 'tomato', 'berry', 'peach']);
  });
  it('leaves non-plurals alone', () => {
    for (const w of ['hummus', 'couscous', 'asparagus', 'molasses', 'glass', 'gas']) expect(foldPlural(w)).toBe(w);
    expect(foldPlural('lentils')).toBe(foldPlural('lentils'));
  });
});
