import { describe, expect, it } from 'vitest';
import type { Gap, Ingredient } from '../recipes/schema.js';
import { MAX_GAPS, MAX_QUESTION_CHARS, withCodeGaps, normaliseGaps, unusedIngredientGaps } from './gaps.js';

const ing = (item: string, quantity: number | null, unit: string | null = null): Ingredient => ({ group: null, quantity, unit, item, note: null });

describe('normaliseGaps', () => {
  it('nulls a blank or whitespace-only question', () => {
    expect(normaliseGaps([{ about: 'servings', question: '  ' }, { about: 'time', question: '' }])).toEqual([
      { about: 'servings', question: null },
      { about: 'time', question: null },
    ]);
  });
  it('nulls an over-long question rather than truncating it', () => {
    const long = 'x'.repeat(MAX_QUESTION_CHARS + 1);
    expect(normaliseGaps([{ about: 'servings', question: long }])).toEqual([{ about: 'servings', question: null }]);
  });
  it('keeps a question of exactly the limit', () => {
    const ok = 'x'.repeat(MAX_QUESTION_CHARS);
    expect(normaliseGaps([{ about: 'servings', question: ok }])[0]!.question).toBe(ok);
  });
  it('keeps the first eight and drops the rest', () => {
    const gaps: Gap[] = Array.from({ length: 12 }, (_, i) => ({ about: `gap ${i}`, question: null }));
    const out = normaliseGaps(gaps);
    expect(out).toHaveLength(MAX_GAPS);
    expect(out.map((g) => g.about)).toEqual(gaps.slice(0, 8).map((g) => g.about));
  });
  it('keeps one gap per about, so one answer box cannot serve two questions', () => {
    expect(
      normaliseGaps([
        { about: 'butter', question: 'How much butter?' },
        { about: 'butter', question: 'Which step uses the butter?' },
      ]),
    ).toEqual([{ about: 'butter', question: 'How much butter?' }]);
  });
  it('folds two abouts that differ only in case or padding', () => {
    expect(
      normaliseGaps([
        { about: 'Butter', question: 'How much butter?' },
        { about: ' butter ', question: 'And how much butter?' },
      ]),
    ).toEqual([{ about: 'Butter', question: 'How much butter?' }]);
  });
  it('dedupes before the cap, so a duplicate does not cost a real gap its place', () => {
    const gaps: Gap[] = [
      { about: 'gap 0', question: null },
      { about: 'gap 0', question: null },
      ...Array.from({ length: 8 }, (_, i) => ({ about: `gap ${i + 1}`, question: null })),
    ];
    expect(normaliseGaps(gaps).map((g) => g.about)).toEqual(['gap 0', 'gap 1', 'gap 2', 'gap 3', 'gap 4', 'gap 5', 'gap 6', 'gap 7']);
  });
  it('is idempotent', () => {
    const gaps: Gap[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ about: `gap ${i}`, question: i % 2 ? '  ' : `Question ${i}?` })),
      { about: 'long', question: 'y'.repeat(200) },
    ];
    const once = normaliseGaps(gaps);
    expect(normaliseGaps(once)).toEqual(once);
  });
});

describe('unusedIngredientGaps', () => {
  const wine = [ing('red wine', 150, 'ml')];
  it('asks which step uses a quantified ingredient no step links', () => {
    expect(unusedIngredientGaps({ ingredients: wine, steps: [{ ingredients: [] }] }, [])).toEqual([
      { about: 'red wine is not used in any step', question: 'Which step uses the red wine?' },
    ]);
  });
  it('says nothing about an unquantified ingredient', () => {
    expect(unusedIngredientGaps({ ingredients: [ing('salt', null)], steps: [{ ingredients: [] }] }, [])).toEqual([]);
  });
  it('says nothing about an ingredient whose item is all stop words', () => {
    expect(unusedIngredientGaps({ ingredients: [ing('optional extra', 1)], steps: [{ ingredients: [] }] }, [])).toEqual([]);
  });
  it('says nothing when the model already asked about it', () => {
    expect(unusedIngredientGaps({ ingredients: wine, steps: [{ ingredients: [] }] }, [{ about: 'quantity for red wine', question: null }])).toEqual([]);
    expect(unusedIngredientGaps({ ingredients: wine, steps: [{ ingredients: [] }] }, [{ about: 'method', question: 'When does the wine go in?' }])).toEqual([]);
  });
  it('says nothing about an ingredient a step does link', () => {
    expect(unusedIngredientGaps({ ingredients: wine, steps: [{ ingredients: [0] }] }, [])).toEqual([]);
  });
});

describe('unusedIngredientGaps with repeated items', () => {
  it('reports two unused lines of the same item once', () => {
    const out = unusedIngredientGaps({ ingredients: [ing('butter', 50, 'g'), ing('butter', 20, 'g')], steps: [{ ingredients: [] }] }, []);
    expect(out).toEqual([{ about: 'butter is not used in any step', question: 'Which step uses the butter?' }]);
  });
});

describe('withCodeGaps', () => {
  const model = (n: number): Gap[] => Array.from({ length: n }, (_, i) => ({ about: `gap ${i}`, question: null }));
  const added = (n: number): Gap[] => Array.from({ length: n }, (_, i) => ({ about: `unused ${i}`, question: 'Which step?' }));
  it('keeps the model gaps first and the code gaps after', () => {
    expect(withCodeGaps(model(2), added(1)).map((g) => g.about)).toEqual(['gap 0', 'gap 1', 'unused 0']);
  });
  it('displaces the end of the model gaps rather than the code gaps', () => {
    const out = withCodeGaps(model(8), added(2));
    expect(out.map((g) => g.about)).toEqual([...model(6).map((g) => g.about), 'unused 0', 'unused 1']);
  });
  it('caps code gaps alone at eight', () => {
    expect(withCodeGaps(model(3), added(10)).map((g) => g.about)).toEqual(added(8).map((g) => g.about));
  });
});
