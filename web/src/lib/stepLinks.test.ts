import { describe, expect, it } from 'vitest';
import { remapStepLinks } from './stepLinks';
import type { Ingredient } from '../../../server/src/recipes/schema';
import type { Step } from '../../../server/src/recipes/schema';

const ing = (item: string, quantity: number | null = null): Ingredient => ({ group: null, quantity, unit: null, item, note: null });
const step = (links: number[], text = 's'): Step => ({ text, imageId: null, ingredients: links });

describe('remapStepLinks', () => {
  it('keeps links on the right ingredient when reordered', () => {
    const out = remapStepLinks([ing('a'), ing('b'), ing('c')], [ing('c'), ing('a'), ing('b')], [step([0, 2])]);
    expect(out[0].ingredients).toEqual([0, 1]);
  });
  it('drops only the links of a deleted ingredient', () => {
    const out = remapStepLinks([ing('a'), ing('b'), ing('c')], [ing('a'), ing('c')], [step([0, 1, 2])]);
    expect(out[0].ingredients).toEqual([0, 1]);
  });
  it('shifts indexes when an ingredient is inserted', () => {
    const out = remapStepLinks([ing('a'), ing('b')], [ing('x'), ing('a'), ing('b')], [step([0, 1])]);
    expect(out[0].ingredients).toEqual([1, 2]);
  });
  it('drops the link when an ingredient text is edited', () => {
    const out = remapStepLinks([ing('a'), ing('b')], [ing('a'), ing('bb')], [step([0, 1])]);
    expect(out[0].ingredients).toEqual([0]);
  });
  it('matches case-insensitively via the formatted line', () => {
    const out = remapStepLinks([ing('Salt', 1)], [ing('salt', 1)], [step([0])]);
    expect(out[0].ingredients).toEqual([0]);
  });
  it('maps duplicate identical lines in order', () => {
    const out = remapStepLinks([ing('egg'), ing('egg')], [ing('egg'), ing('egg')], [step([0]), step([1])]);
    expect(out.map((s) => s.ingredients)).toEqual([[0], [1]]);
  });
  it('maps duplicates in order after an insertion', () => {
    const out = remapStepLinks([ing('egg'), ing('egg')], [ing('x'), ing('egg'), ing('egg')], [step([0]), step([1])]);
    expect(out.map((s) => s.ingredients)).toEqual([[1], [2]]);
  });
  it('sorts and dedupes, leaves text and imageId alone', () => {
    const s: Step = { text: 't', imageId: 'h.jpg', ingredients: [1, 0, 1] };
    const out = remapStepLinks([ing('a'), ing('b')], [ing('b'), ing('a')], [s]);
    expect(out[0]).toEqual({ text: 't', imageId: 'h.jpg', ingredients: [0, 1] });
  });
});
