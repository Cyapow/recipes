// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { listDrafts } from './drafts';

beforeEach(() => {
  localStorage.clear();
});

describe('listDrafts', () => {
  it('reads a draft saved before gaps had questions', () => {
    localStorage.setItem('recipes.drafts', JSON.stringify([
      { id: 'd1', kind: 'describe', savedAt: 1, gaps: ['servings', 'quantity for flour'] },
    ]));
    expect(listDrafts()[0]!.gaps).toEqual([
      { about: 'servings', question: null },
      { about: 'quantity for flour', question: null },
    ]);
  });
});
