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

export function forgetSignedIn(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
