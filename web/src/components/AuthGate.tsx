import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, getMe } from '../api';
import { forgetSignedIn, rememberSignedIn, wasSignedIn } from '../lib/session';
import { SignIn } from '../pages/SignIn';

type State = 'loading' | 'signedIn' | 'signedOut' | 'offline';

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>('loading');
  const onSignedIn = useCallback(() => setState('signedIn'), []);

  useEffect(() => {
    let live = true;
    getMe().then(
      () => {
        rememberSignedIn();
        if (live) setState('signedIn');
      },
      (e: unknown) => {
        // Offline is not signed out: only a real 401 means the session is gone.
        if (e instanceof ApiError && e.status === 401) {
          forgetSignedIn();
          if (live) setState('signedOut');
        } else if (live) {
          setState(wasSignedIn() ? 'offline' : 'signedOut');
        }
      },
    );
    return () => { live = false; };
  }, []);

  if (state === 'loading') return <p className="hint" aria-busy="true">Loading…</p>;
  if (state === 'signedOut') return <SignIn onSignedIn={onSignedIn} />;
  return (
    <>
      {state === 'offline' && <p className="banner" role="status">You're offline. Showing what's saved on this device.</p>}
      {children}
    </>
  );
}
