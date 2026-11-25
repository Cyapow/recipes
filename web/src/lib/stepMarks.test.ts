import { describe, expect, it } from 'vitest';
import type { Step } from '../../../server/src/recipes/schema';
import { derive } from './stepIdentity';
import { markFor, stepMarks } from './stepMarks';

const s = (text: string): Step => ({ text, imageId: null, ingredients: [] });
const before = [s('Mix'), s('Bake')];
const after = [s('Mix'), s('Cool for 20 minutes'), s('Bake until golden')];

describe('stepMarks', () => {
  it('marks a step with no from as new and a reworded step as reworded', () => {
    const marks = stepMarks(before, after, [0, null, 1]);
    expect(markFor(marks, after[0])).toBeNull();
    expect(markFor(marks, after[1])).toBe('New');
    expect(markFor(marks, after[2])).toBe('Reworded');
  });

  it('does not mark a step that only moved', () => {
    const moved = [s('Bake'), s('Mix')];
    expect(markFor(stepMarks(before, moved, [1, 0]), moved[0])).toBeNull();
  });

  it('keeps a mark on its step through an edit, a move and a delete', () => {
    const revised = after.slice(0, 2);
    const marks = stepMarks(before, revised, [0, null]);
    const moved = [derive(revised[1], { text: 'changed by hand' }), revised[0]];
    expect(markFor(marks, moved[0])).toBe('New');
    expect(markFor(marks, moved[1])).toBeNull();
    // deleting the other step leaves the mark where it was
    expect(markFor(marks, moved.slice(0, 1)[0])).toBe('New');
  });

  it('has no marks for an undefined marks object', () => {
    expect(markFor(undefined, after[0])).toBeNull();
  });

  it('ignores a link-only change', () => {
    const linked = [{ ...before[0], ingredients: [0] }];
    expect(markFor(stepMarks(before, linked, [0]), linked[0])).toBeNull();
  });
});
