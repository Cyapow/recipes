import type { Gap } from '../../../server/src/recipes/schema';

export type Answer = { gap: Gap; answer: string };

export const MAX_ANSWERS = 8;
export const MAX_ANSWER_CHARS = 200;
/**
 * Mirrors MAX_GAPS in server/src/ai/gaps.ts, which the web must not import (it would pull a server AI module,
 * and with it Fastify, into the bundle). The server caps its own output; this caps what the merge produces.
 */
export const MAX_GAPS = 8;

/** Shown in the panel instead of sending: a recipe with no title is not one /api/ai/revise will take. */
export const ANSWER_NEEDS_TITLE = 'Give the recipe a title first, then answer the questions.';

/** Shown when an apply fails, wherever answers are applied from. */
export const ANSWER_FAILED = 'Could not apply your answers';

/**
 * Builds the single instruction sent to /api/ai/revise from the person's answers. Both halves of a pair are
 * untrusted — the question is the model's words, the answer is the person's — so whitespace is collapsed in
 * each: one answer stays one line, and neither half can forge a numbered "N. Q: … A: …" pair of its own.
 */
export function answerInstruction(answers: Answer[]): string {
  const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
  const lines = answers.map(({ gap, answer }, i) => `${i + 1}. Q: ${oneLine(gap.question ?? gap.about)} A: ${oneLine(answer)}`);
  return ['Here are answers to the questions you asked.', ...lines].join('\n');
}

/**
 * A revise call's gaps describe only its instruction, so the questions that were
 * not answered are carried across here. Asked gaps leave the list unless the
 * model sent them back; a returned gap replaces a kept one with the same `about`.
 *
 * The result is capped at MAX_GAPS, as every list the server produces is: without it the kept and the returned
 * gaps add up, and a few applies turn the panel into the wall of questions the design rules out. When the list
 * is full the returned gaps take their places from the end of the kept ones, because they are the sharper
 * wording of what is still missing.
 */
export function mergeGaps(before: Gap[], asked: Gap[], returned: Gap[]): Gap[] {
  const askedAbout = new Set(asked.map((g) => g.about));
  const returnedByAbout = new Map(returned.map((g) => [g.about, g]));
  const added = [...returnedByAbout.values()].slice(0, MAX_GAPS);
  const kept = before.filter((g) => !askedAbout.has(g.about) && !returnedByAbout.has(g.about));
  return [...kept.slice(0, MAX_GAPS - added.length), ...added];
}
