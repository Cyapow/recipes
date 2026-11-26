import { describe, expect, it } from 'vitest';
import { MAX_ANSWERS, MAX_ANSWER_CHARS, answerInstruction, mergeGaps } from './gaps';

const gap = (about: string, question: string | null = null) => ({ about, question });

describe('answerInstruction', () => {
  it('numbers each question and answer', () => {
    expect(
      answerInstruction([
        { gap: gap('quantity for red wine', 'How much red wine did you add?'), answer: 'about 150ml' },
        { gap: gap('servings', 'How many does this serve?'), answer: '4' },
      ]),
    ).toBe(
      'Here are answers to the questions you asked.\n' +
        '1. Q: How much red wine did you add? A: about 150ml\n' +
        '2. Q: How many does this serve? A: 4',
    );
  });

  it('falls back to the about text for a gap with no question', () => {
    expect(answerInstruction([{ gap: gap('brand'), answer: 'Heinz' }])).toBe(
      'Here are answers to the questions you asked.\n1. Q: brand A: Heinz',
    );
  });

  it('fits inside MAX_REVISE_CHARS at the worst case', () => {
    const answers = Array.from({ length: MAX_ANSWERS }, (_, i) => ({
      gap: gap(`about ${i}`, 'q'.repeat(140)),
      answer: 'a'.repeat(MAX_ANSWER_CHARS),
    }));
    // 4000 mirrors MAX_REVISE_CHARS in server/src/ai/routes.ts, which the web must not import.
    expect(answerInstruction(answers).length).toBeLessThan(4000);
  });
});

describe('mergeGaps', () => {
  const a = gap('a', 'Qa?');
  const b = gap('b', 'Qb?');
  const c = gap('c', 'Qc?');

  it('keeps the gaps that were not asked about', () => {
    expect(mergeGaps([a, b, c], [b], [])).toEqual([a, c]);
  });

  it('appends what came back after the kept ones', () => {
    const d = gap('d', 'Qd?');
    expect(mergeGaps([a, b], [b], [d])).toEqual([a, d]);
  });

  it('dedupes a returned gap against a kept one with the same about, returned winning', () => {
    const sharper = gap('a', 'Sharper a?');
    expect(mergeGaps([a, b], [b], [sharper])).toEqual([sharper]);
  });

  it('drops an answered gap that did not come back', () => {
    expect(mergeGaps([a, b], [a], [])).toEqual([b]);
  });

  it('keeps a re-asked gap with the new wording', () => {
    const sharper = gap('b', 'Sharper b?');
    expect(mergeGaps([a, b], [b], [sharper])).toEqual([a, sharper]);
  });
});
