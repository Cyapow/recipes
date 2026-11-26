// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { listDrafts } from './drafts';

beforeEach(() => {
  localStorage.clear();
});

const store = (gaps: unknown) =>
  localStorage.setItem('recipes.drafts', JSON.stringify([{ id: 'd1', kind: 'describe', savedAt: 1, gaps }]));

describe('listDrafts', () => {
  it('reads a draft saved before gaps had questions', () => {
    store(['servings', 'quantity for flour']);
    expect(listDrafts()[0]!.gaps).toEqual([
      { about: 'servings', question: null },
      { about: 'quantity for flour', question: null },
    ]);
  });

  it('passes a gap written since through untouched', () => {
    store([{ about: 'red wine', question: 'How much red wine did you add?' }, { about: 'brand', question: null }]);
    expect(listDrafts()[0]!.gaps).toEqual([
      { about: 'red wine', question: 'How much red wine did you add?' },
      { about: 'brand', question: null },
    ]);
  });

  it('drops an entry that is neither a string nor a gap, keeping the rest', () => {
    store(['servings', null, 42, {}, { question: 'Whose card is this?' }, { about: 'brand', question: 7 }]);
    expect(listDrafts()[0]!.gaps).toEqual([
      { about: 'servings', question: null },
      // An `about` with an unusable `question` is still a gap: it degrades to a plain note.
      { about: 'brand', question: null },
    ]);
  });

  it('leaves a draft with no gaps alone', () => {
    store(undefined);
    expect(listDrafts()[0]!.gaps).toBeUndefined();
  });
});
