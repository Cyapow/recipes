import { useEffect, useRef, useState } from 'react';
import { ApiError, getAuthConfig, signInWithGoogle } from '../api';
import { rememberSignedIn } from '../lib/session';

type GoogleId = {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void }): void;
  renderButton(el: HTMLElement, o: { theme: 'outline'; size: 'large' }): void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';
export const GSI_TIMEOUT_MS = 15000;
const UNREACHABLE = "Couldn't reach Google. Check your connection and try again.";

function loadGoogle(): Promise<GoogleId> {
  const ready = window.google?.accounts.id;
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (!script) {
      script = document.createElement('script');
      script.src = GSI_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    const node = script;
    let timer: ReturnType<typeof setTimeout>;
    // A node that failed, hung or loaded without defining google must not stay in the head: the next
    // attempt would adopt it and wait on listeners that can never fire again, hanging for good.
    const fail = (message: string) => {
      clearTimeout(timer);
      node.remove();
      reject(new Error(message));
    };
    timer = setTimeout(() => fail(UNREACHABLE), GSI_TIMEOUT_MS);
    node.addEventListener('load', () => {
      const id = window.google?.accounts.id;
      if (!id) return fail('Google sign-in did not load');
      clearTimeout(timer);
      resolve(id);
    });
    node.addEventListener('error', () => fail(UNREACHABLE));
  });
}

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  // canRetry marks the failures a fresh load can clear, as opposed to the server refusing an account.
  const [error, setError] = useState<{ message: string; canRetry: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        setError(null);
        const { clientId } = await getAuthConfig();
        if (!live) return;
        setConfigured(clientId !== null);
        if (clientId === null) return;
        const id = await loadGoogle();
        if (!live || !buttonRef.current) return;
        id.initialize({
          client_id: clientId,
          callback: async ({ credential }) => {
            try {
              await signInWithGoogle(credential);
              rememberSignedIn();
              onSignedIn();
            } catch (e) {
              // The server words its refusal itself; show it as it is.
              const body = e instanceof ApiError ? (e.body as { error?: string } | undefined) : undefined;
              setError({ message: body?.error ?? 'Sign-in failed. Try again.', canRetry: false });
            }
          },
        });
        id.renderButton(buttonRef.current, { theme: 'outline', size: 'large' });
      } catch (e) {
        if (live) setError({ message: e instanceof Error ? e.message : 'Sign-in failed. Try again.', canRetry: true });
      }
    })();
    return () => { live = false; };
  }, [onSignedIn, attempt]);

  return (
    <main className="page not-found">
      <div className="card">
        <h1>Sign in</h1>
        {configured === false ? (
          <p className="hint">This server isn't set up for Google sign-in yet.</p>
        ) : (
          <div className="gsi-slot" ref={buttonRef} />
        )}
        {error && <p role="alert" className="hint">{error.message}</p>}
        {error?.canRetry && (
          <button type="button" className="primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        )}
      </div>
    </main>
  );
}
