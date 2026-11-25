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
  // A mark on the wrong step is worse than no mark, so malformed provenance earns none at all: a stepsFrom that is
  // not one-to-one with the revised steps is not provenance, and nor is an index outside the original method.
  if (stepsFrom.length !== afterSteps.length) return marks;
  afterSteps.forEach((step, i) => {
    const from = stepsFrom[i];
    if (from === null) {
      marks.added.add(stepId(step));
      return;
    }
    const was = from !== undefined && Number.isInteger(from) && from >= 0 && from < beforeSteps.length ? beforeSteps[from] : undefined;
    if (was && was.text !== step.text) marks.reworded.add(stepId(step));
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
