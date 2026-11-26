import { useRef, useState } from 'react';
import { reviseRecipe, type Gap, type RecipeInput } from '../api';
import { describeAiError } from './aiError';
import { answerInstruction, mergeGaps, type Answer } from './gaps';

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

  /** Rejects when the apply fails: that is what keeps the typed answers in the panel. */
  async function onAnswer(answers: Answer[]) {
    if (inFlight.current) return;
    inFlight.current = true;
    setAnswering(true);
    setAnswerError(null);
    try {
      const { gaps: returned, stepsFrom: _s, provider: _p, model: _m, ...input } = await reviseRecipe(current(), answerInstruction(answers));
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

  return { answering, answerError, onAnswer };
}
