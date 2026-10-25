export type ProviderName = 'anthropic' | 'openai' | 'gemini';
export const PROVIDER_NAMES: readonly ProviderName[] = ['anthropic', 'openai', 'gemini'];

/** Why a provider call failed. Deliberately coarse: it is safe to show and never carries upstream text. */
export type ProviderErrorCode = 'no_credit' | 'auth' | 'rate_limit' | 'unavailable' | 'timeout' | 'other';

export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode) {
    super(`AI provider error: ${code}`); // fixed text: upstream messages may echo request details or keys
    this.name = 'ProviderError';
  }
}

const MESSAGES: Record<ProviderErrorCode, string> = {
  no_credit: 'The AI account is out of credit. Add credit or switch provider.',
  auth: 'The AI key was rejected. Check the key in .env.',
  rate_limit: 'The AI is busy right now. Try again in a minute.',
  unavailable: "The AI didn't respond. Try again.",
  timeout: "The AI didn't respond. Try again.",
  other: 'AI request failed',
};
export const aiErrorMessage = (code: ProviderErrorCode): string => MESSAGES[code];

/** Provider-neutral conversation. Providers translate it; `raw` is whatever the provider needs to replay its own turn. */
export type ProviderMessage =
  | { role: 'user'; text: string }
  /** The previous answer was unusable. `problem` is the validation error, or null when no recipe came back at all. */
  | { role: 'retry'; raw: unknown; problem: string | null };

export type ProviderRequest = {
  system: string;
  messages: ProviderMessage[];
  maxTokens: number;
  signal: AbortSignal;
  timeoutMs: number;
};

export type ProviderResult =
  | { kind: 'draft'; input: unknown; raw: unknown }
  | { kind: 'no_draft'; raw: unknown }
  | { kind: 'refusal' }
  | { kind: 'truncated' };

export interface Provider {
  name: ProviderName;
  label: string;
  model: string;
  /** Throws ProviderError only; any other throw is treated as 'unavailable' by the caller. */
  complete(req: ProviderRequest): Promise<ProviderResult>;
}

const BILLING = /insufficient_quota|billing|credit|payment|prepay/i;
const BAD_KEY = /api[_ ]?key (is )?(not valid|invalid)|invalid[_ ]api[_ ]key|incorrect api key|api_key_invalid|reported as leaked/i;

/** Classify an HTTP failure from its status and (transiently inspected) body text. The text is never stored. */
export function classifyHttpError(status: number, text = ''): ProviderErrorCode {
  if (BAD_KEY.test(text)) return 'auth';
  if (status === 402) return 'no_credit';
  if (status === 401) return 'auth';
  if (status === 403) return BILLING.test(text) ? 'no_credit' : 'auth';
  if (status === 429) return BILLING.test(text) ? 'no_credit' : 'rate_limit';
  if (status === 400) return BILLING.test(text) ? 'no_credit' : 'other';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'unavailable';
  return 'other';
}

/** Rejects with ProviderError('timeout') as soon as the signal aborts, whatever the wrapped promise does. */
export function raceAbort<T>(signal: AbortSignal, p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ProviderError('timeout'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Shared by the fetch-based providers: POST JSON, map every failure to a ProviderError, return parsed JSON. */
export async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await raceAbort(
      signal,
      (async () => {
        const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new ProviderError(classifyHttpError(res.status, text));
        }
        return res.json();
      })(),
    );
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(signal.aborted ? 'timeout' : 'unavailable'); // drops the upstream error: it may echo the key
  }
}
