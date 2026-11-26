import { describe, expect, it } from 'vitest';
import type { Gap, Ingredient } from '../recipes/schema.js';
import { MAX_GAPS, MAX_QUESTION_CHARS, normaliseGaps, unusedIngredientGaps } from './gaps.js';

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
