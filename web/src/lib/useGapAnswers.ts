import { useRef, useState } from 'react';
import { reviseRecipe, type Gap, type RecipeInput } from '../api';
import { describeAiError } from './aiError';
import { ANSWER_NEEDS_TITLE, answerInstruction, mergeGaps, type Answer } from './gaps';

export type GapAnswersOptions = {
  /** The questions on screen. The ones that were not answered are carried across the revision. */
  gaps: Gap[];
  setGaps(gaps: Gap[]): void;
  /** The form's contents right now, so the answers apply to what is on screen and not to the draft as it arrived. */
  current(): RecipeInput;
  /** The revision: the page reseeds the form with it (a new `key`) and writes it to the device draft. */
  onRevised(input: RecipeInput): void;
};

/**
 * Answering the AI's questions from a draft: the answers go out as one instruction to /api/ai/revise, whose prompt
 * adds nothing else, so nothing has to be drafted again. Returns what `RecipeForm` needs to make its panel answerable.
 *
 * The editor does this through its own `onRevise` instead, which also keeps step marks, a change summary and Undo.
 */
export function useGapAnswers({ gaps, setGaps, current, onRevised }: GapAnswersOptions) {
  const [answering, setAnswering] = useState(false);
  const inFlight = useRef(false);
  const [answerError, setAnswerError] = useState<string | null>(null);

  /**
   * Rejects whenever the answers were not applied — a refusal as much as a failure — because the panel reads a
   * resolve as success and clears every box it sent.
   */
  async function onAnswer(answers: Answer[]) {
    if (inFlight.current) throw new Error('an apply is already in flight');
    const recipe = current();
    if (!recipe.title.trim()) {
      setAnswerError(ANSWER_NEEDS_TITLE);
      throw new Error('the recipe has no title');
    }
    inFlight.current = true;
    setAnswering(true);
    setAnswerError(null);
    try {
      const { gaps: returned, stepsFrom: _s, provider: _p, model: _m, ...input } = await reviseRecipe(recipe, answerInstruction(answers));
      // The questions answered are exactly the ones the panel sent, so only those leave the list.
      setGaps(mergeGaps(gaps, answers.map((a) => a.gap), returned));
      onRevised(input);
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

  return { answering, answerError, onAnswer, clearAnswerError };
}
