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
    script.addEventListener('load', () => {
      const id = window.google?.accounts.id;
      return id ? resolve(id) : reject(new Error('Google sign-in did not load'));
    });
    script.addEventListener('error', () => reject(new Error("Couldn't reach Google. Check your connection and try again.")));
  });
}

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
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
              setError(body?.error ?? 'Sign-in failed. Try again.');
            }
          },
        });
        id.renderButton(buttonRef.current, { theme: 'outline', size: 'large' });
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Sign-in failed. Try again.');
      }
    })();
    return () => { live = false; };
  }, [onSignedIn]);

  return (
    <main className="page not-found">
      <h1>Sign in</h1>
      {configured === false ? (
        <p className="hint">This server isn't set up for Google sign-in yet.</p>
      ) : (
        <div ref={buttonRef} />
      )}
      {error && <p role="alert" className="hint">{error}</p>}
    </main>
  );
}
