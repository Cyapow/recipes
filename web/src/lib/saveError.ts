type Issue = { path?: unknown[]; message?: string };

const GENERIC = 'Could not save recipe';

/**
 * User-facing text for a failed save. A 400 carrying zod `issues` names the first problem (and the step
 * number for step issues); anything else is the generic message. Duck-typed so it works with any ApiError.
 */
export function describeSaveError(e: unknown): string {
  const status = (e as { status?: unknown } | null)?.status;
  const issues = (e as { body?: { issues?: unknown } } | null)?.body?.issues;
  if (status !== 400 || !Array.isArray(issues) || issues.length === 0) return GENERIC;
  const first = issues[0] as Issue;
  const message = typeof first.message === 'string' && first.message ? first.message : null;
  if (!message) return GENERIC;
  const path = Array.isArray(first.path) ? first.path : [];
  const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : '';
  if (path[0] === 'steps' && typeof path[1] === 'number') return `Step ${path[1] + 1} can't be saved: ${message}${more}`;
  return `${message}${more}`;
}
