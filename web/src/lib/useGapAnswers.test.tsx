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

function setup(input: RecipeInput | null = recipe) {
  const setGaps = vi.fn();
  const onRevised = vi.fn();
  const save = vi.fn();
  const { result } = renderHook(() => useGapAnswers({ gaps: [wine], setGaps, input, onRevised, save }));
  return { result, setGaps, onRevised, save };
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

  it('refuses when there is nothing to revise yet', async () => {
    const { result, save } = setup(null);
    await expect(result.current.onAnswer(answers)).rejects.toThrow(/nothing to revise/);
    expect(reviseRecipe).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
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

  // The panel the message sat under is remounted with empty boxes by an apply, so the message must not outlive it.
  it('clears an earlier refusal once the answers apply', async () => {
    const { result } = setup({ ...recipe, title: '  ' });
    await act(async () => {
      await expect(result.current.onAnswer(answers)).rejects.toThrow();
    });
    expect(result.current.answerError).toBe(ANSWER_NEEDS_TITLE);
    // The form reports a titled recipe, as it does once the person types the title the message asked for.
    vi.mocked(reviseRecipe).mockResolvedValue({ ...recipe, gaps: [], stepsFrom: [0] });
    await act(async () => {
      result.current.inputRef.current = () => recipe;
      await result.current.onAnswer(answers);
    });
    expect(result.current.answerError).toBeNull();
  });

  it('clears a failed apply once a later one succeeds', async () => {
    vi.mocked(reviseRecipe).mockRejectedValueOnce(new Error('network'));
    const { result } = setup();
    await act(async () => {
      await expect(result.current.onAnswer(answers)).rejects.toThrow();
    });
    expect(result.current.answerError).not.toBeNull();
    vi.mocked(reviseRecipe).mockResolvedValue({ ...recipe, gaps: [], stepsFrom: [0] });
    await act(async () => {
      await result.current.onAnswer(answers);
    });
    expect(result.current.answerError).toBeNull();
  });
});
