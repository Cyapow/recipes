import { describe, expect, it } from 'vitest';
import { describeSaveError } from './saveError';

const err = (status: number, body?: unknown) => Object.assign(new Error('x'), { name: 'ApiError', status, body });

describe('describeSaveError', () => {
  it('names the step for a steps issue', () => {
    const e = err(400, { issues: [{ path: ['steps', 1, 'text'], message: 'Step text looks corrupted ([object Object])' }] });
    expect(describeSaveError(e)).toBe("Step 2 can't be saved: Step text looks corrupted ([object Object])");
  });
  it('counts further issues', () => {
    const e = err(400, { issues: [
      { path: ['steps', 0], message: 'bad' }, { path: ['steps', 3], message: 'worse' }, { path: ['title'], message: 'nope' },
    ] });
    expect(describeSaveError(e)).toBe("Step 1 can't be saved: bad (and 2 more)");
  });
  it('uses the first issue message otherwise', () => {
    expect(describeSaveError(err(400, { issues: [{ path: ['title'], message: 'Too small' }] }))).toBe('Too small');
  });
  it('falls back to the generic text', () => {
    for (const e of [err(400), err(400, { issues: [] }), err(500, { issues: [{ path: [], message: 'x' }] }), new Error('boom'), null]) {
      expect(describeSaveError(e)).toBe('Could not save recipe');
    }
  });
});
