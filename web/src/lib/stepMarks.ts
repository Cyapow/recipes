import type { Step } from '../../../server/src/recipes/schema';
import { stepId } from './stepIdentity';

/** Which steps a revision added or reworded, keyed by step identity so the marks follow a step as it is moved or edited. */
export type StepMarks = { added: Set<string>; reworded: Set<string> };

/**
 * `stepsFrom[i]` is the index in `beforeSteps` that `afterSteps[i]` came from, or null if it is new.
 * Marks are keyed on the identity of the `afterSteps` objects, so the caller must pass those very
 * objects to the form. Only the step's text counts: a link-only change earns no mark.
 */
export function stepMarks(beforeSteps: Step[], afterSteps: Step[], stepsFrom: (number | null)[]): StepMarks {
  const marks: StepMarks = { added: new Set(), reworded: new Set() };
  afterSteps.forEach((step, i) => {
    const from = stepsFrom[i];
    if (from === null || from === undefined) marks.added.add(stepId(step));
    else if (beforeSteps[from]?.text !== step.text) marks.reworded.add(stepId(step));
  });
  return marks;
}

export function markFor(marks: StepMarks | undefined, step: Step): 'New' | 'Reworded' | null {
  if (!marks) return null;
  const id = stepId(step);
  if (marks.added.has(id)) return 'New';
  if (marks.reworded.has(id)) return 'Reworded';
  return null;
}
