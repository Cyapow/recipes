import type { Gap } from '../../../server/src/recipes/schema';

export type Answer = { gap: Gap; answer: string };

export const MAX_ANSWERS = 8;
export const MAX_ANSWER_CHARS = 200;

/** Shown in the panel instead of sending: a recipe with no title is not one /api/ai/revise will take. */
export const ANSWER_NEEDS_TITLE = 'Give the recipe a title first, then answer the questions.';

/** Builds the single instruction sent to /api/ai/revise from the person's answers. */
export function answerInstruction(answers: Answer[]): string {
  const lines = answers.map(({ gap, answer }, i) => `${i + 1}. Q: ${gap.question ?? gap.about} A: ${answer}`);
  return ['Here are answers to the questions you asked.', ...lines].join('\n');
}

/**
 * A revise call's gaps describe only its instruction, so the questions that were
 * not answered are carried across here. Asked gaps leave the list unless the
 * model sent them back; a returned gap replaces a kept one with the same `about`.
 */
export function mergeGaps(before: Gap[], asked: Gap[], returned: Gap[]): Gap[] {
  const askedAbout = new Set(asked.map((g) => g.about));
  const returnedByAbout = new Map(returned.map((g) => [g.about, g]));
  const kept = before.filter((g) => !askedAbout.has(g.about) && !returnedByAbout.has(g.about));
  return [...kept, ...returnedByAbout.values()];
}
