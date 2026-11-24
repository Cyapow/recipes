const KEY = 'recipes.signedIn';

// Storage can be blocked (private mode); treating that as "never signed in" is the safe failure.
export function wasSignedIn(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberSignedIn(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // ignore
  }
}

// A plain subscription rather than a window event: typed, and nothing global to leak between tests.
const listeners = new Set<() => void>();

/** Called when any API call comes back 401. Returns the unsubscribe function. */
export function onUnauthorized(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function notifyUnauthorized(): void {
  listeners.forEach((fn) => fn());
}

export function forgetSignedIn(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
