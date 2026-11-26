import { useEffect, useRef, useState } from 'react';
import { reviseRecipe, type Gap, type RecipeInput } from '../api';
import { describeAiError } from './aiError';
import { ANSWER_NEEDS_TITLE, answerInstruction, mergeGaps, type Answer } from './gaps';

export type GapAnswersOptions = {
  /** The questions on screen. The ones that were not answered are carried across the revision. */
  gaps: Gap[];
  setGaps(gaps: Gap[]): void;
  /** What the form was seeded with, or null before there is a draft: stood in for until the form reports its own. */
  input: RecipeInput | null;
  /** Reseeds the page's form with the revision. The page renders it with `revision` in the form's `key`. */
  onRevised(input: RecipeInput): void;
  /** Writes the revision to this page's device draft, with whatever else that page keeps alongside the recipe. */
  save(input: RecipeInput, gaps: Gap[]): void;
};

/**
 * Answering the AI's questions from a draft: the answers go out as one instruction to /api/ai/revise, whose prompt
 * adds nothing else, so nothing has to be drafted again. Returns what `RecipeForm` needs to make its panel
 * answerable, the ref it reports its contents through, and the `revision` that belongs in its `key`.
 *
 * The editor does this through its own `onRevise` instead, which also keeps step marks, a change summary and Undo.
 */
export function useGapAnswers({ gaps, setGaps, input, onRevised, save }: GapAnswersOptions) {
  const [answering, setAnswering] = useState(false);
  const inFlight = useRef(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  // The form reports its contents here, so an answer applies to what is on screen and not to the draft as it arrived.
  const inputRef = useRef<(() => RecipeInput) | null>(null);
  const [revision, setRevision] = useState(0);
  const applied = useRef<RecipeInput | null>(null);

  // A remounted form reports nothing until the person edits it, so the revision is written to the device draft here.
  // This runs after the old form's unmount flush, which would otherwise overwrite it with the pre-answer contents.
  useEffect(() => {
    if (applied.current) save(applied.current, gaps);
  }, [revision]);

  /**
   * Rejects whenever the answers were not applied — a refusal as much as a failure — because the panel reads a
   * resolve as success and clears every box it sent.
   */
  async function onAnswer(answers: Answer[]) {
    if (inFlight.current) throw new Error('an apply is already in flight');
    const recipe = inputRef.current?.() ?? input;
    if (!recipe) throw new Error('nothing to revise');
    if (!recipe.title.trim()) {
      setAnswerError(ANSWER_NEEDS_TITLE);
      throw new Error('the recipe has no title');
    }
    inFlight.current = true;
    setAnswering(true);
    setAnswerError(null);
    try {
      const { gaps: returned, stepsFrom: _s, provider: _p, model: _m, ...next } = await reviseRecipe(recipe, answerInstruction(answers));
      // The questions answered are exactly the ones the panel sent, so only those leave the list.
      setGaps(mergeGaps(gaps, answers.map((a) => a.gap), returned));
      applied.current = next;
      onRevised(next);
      setRevision((n) => n + 1);
    } catch (e) {
      setAnswerError(describeAiError(e, 'Could not apply your answers'));
      throw e;
    } finally {
      inFlight.current = false;
      setAnswering(false);
    }
  }

  // Called where a page starts a fresh draft: the panel it was shown under is gone, so the message no longer applies.
  const clearAnswerError = () => setAnswerError(null);

  return { answering, answerError, onAnswer, clearAnswerError, inputRef, revision };
}
