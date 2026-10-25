import type { Step } from '../../../server/src/recipes/schema';

// Steps are plain data, but the editor and form need to follow "the same step" across edits and moves.
// Identity lives in a side table keyed by the step object; edits must carry it over with `derive`.
const ids = new WeakMap<Step, string>();
let next = 0;

export function stepId(step: Step): string {
  let id = ids.get(step);
  if (!id) {
    id = `step-${next++}`;
    ids.set(step, id);
  }
  return id;
}

/** A copy of `from` with changes applied, keeping `from`'s identity. */
export function derive(from: Step, changes: Partial<Step>): Step {
  const to = { ...from, ...changes };
  ids.set(to, stepId(from));
  return to;
}
