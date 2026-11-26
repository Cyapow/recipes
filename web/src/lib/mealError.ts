/**
 * User-facing text for a failed meal write. The meal routes answer a 400 with one plain sentence in `body.error`
 * ("One of those recipes no longer exists", "A recipe can only be in a meal once"), which is the only thing that
 * tells the person what to do about it; anything else falls back to the caller's own words. Duck-typed, so it works
 * with any ApiError.
 */
export function describeMealError(e: unknown, fallback: string): string {
  const error = (e as { body?: { error?: unknown } } | null)?.body?.error;
  return typeof error === 'string' && error.trim() !== '' ? error : fallback;
}
