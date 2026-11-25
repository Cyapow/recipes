import { ApiError } from '../api';

/** Turns an AI failure into a sentence for the person; `fallback` leads when nothing more specific is known. */
export function describeAiError(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : '';
  const code = err instanceof ApiError ? (err.body as { code?: string } | undefined)?.code : undefined;
  if (msg === 'AI not configured') return 'AI is not configured on this server (no AI key set in .env).';
  if (code && code !== 'other') return msg; // already a plain-language sentence from the server
  return `${fallback}${msg ? `: ${msg}` : ''}`;
}
