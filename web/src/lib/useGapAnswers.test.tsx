// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useGapAnswers } from './useGapAnswers';
import { ANSWER_NEEDS_TITLE, type Answer } from './gaps';
import type { RecipeInput, Revision } from '../api';

vi.mock('../api', async () => ({ ...(await vi.importActual<typeof import('../api')>('../api')), reviseRecipe: vi.fn() }));
import { reviseRecipe } from '../api';

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(reviseRecipe).mockReset();
});

const wine = { about: 'red wine', question: 'How much red wine did you add?' };
const answers: Answer[] = [{ gap: wine, answer: 'about 150ml' }];
const recipe: RecipeInput = {
  title: 'Spag bol', description: null, origin: 'mine', brand: 'Mine', sourceName: null, sourceUrl: null,
  servings: null, prepMinutes: null, cookMinutes: null, ingredients: [],
  steps: [{ text: 'Brown the mince', imageId: null, ingredients: [] }], notes: null, tags: [], imageIds: [],
};

function setup(input: RecipeInput = recipe) {
  const setGaps = vi.fn();
  const onRevised = vi.fn();
  const { result } = renderHook(() => useGapAnswers({ gaps: [wine], setGaps, current: () => input, onRevised }));
  return { result, setGaps, onRevised };
}

// The panel reads a resolved onAnswer as "applied" and clears every box it sent, so a refusal must reject.
describe('useGapAnswers', () => {
  it('refuses a second apply while one is in flight instead of reporting success', async () => {
    vi.mocked(reviseRecipe).mockReturnValue(new Promise<Revision>(() => {}));
    const { result } = setup();
    await act(async () => {
      void result.current.onAnswer(answers).catch(() => {});
    });
    await expect(result.current.onAnswer(answers)).rejects.toThrow(/in flight/);
    expect(reviseRecipe).toHaveBeenCalledTimes(1);
  });

  it('refuses, and says why, when the recipe has no title', async () => {
    const { result, onRevised } = setup({ ...recipe, title: '  ' });
    await act(async () => {
      await expect(result.current.onAnswer(answers)).rejects.toThrow();
    });
    expect(result.current.answerError).toBe(ANSWER_NEEDS_TITLE);
    expect(reviseRecipe).not.toHaveBeenCalled();
    expect(onRevised).not.toHaveBeenCalled();
  });
});
