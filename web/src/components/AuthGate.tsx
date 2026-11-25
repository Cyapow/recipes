import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, getMe } from '../api';
import { forgetSignedIn, onUnauthorized, rememberSignedIn, wasSignedIn } from '../lib/session';
import { MeProvider, type Me } from '../lib/me';
import { SignIn } from '../pages/SignIn';

type State = 'loading' | 'signedIn' | 'signedOut' | 'offline';

export function AuthGate({ children }: { children: ReactNode }) {
  // A browser that was signed in renders its cached app at once: fetch has no timeout, so waiting on
  // getMe() would leave a hung connection staring at "Loading…". The check can only downgrade from
  // here, on a real 401, and every data call is guarded the same way.
  const [state, setState] = useState<State>(() => (wasSignedIn() ? 'signedIn' : 'loading'));
  const [me, setMe] = useState<Me | null>(null);

  const check = useCallback((live: () => boolean) => {
    getMe().then(
      (who) => {
        rememberSignedIn();
        if (live()) { setMe(who); setState('signedIn'); }
      },
      (e: unknown) => {
        // Offline is not signed out: only a real 401 means the session is gone.
        if (e instanceof ApiError && e.status === 401) {
          forgetSignedIn();
          if (live()) setState('signedOut');
        } else if (live()) {
          setState(wasSignedIn() ? 'offline' : 'signedOut');
        }
      },
    );
  }, []);

  // Signing in here needs the person too, not only a reload.
  const onSignedIn = useCallback(() => {
    setState('signedIn');
    check(() => true);
  }, [check]);

  useEffect(() => {
    let live = true;
    check(() => live);
    const off = onUnauthorized(() => { if (live) setState('signedOut'); });
    return () => { live = false; off(); };
  }, [check]);

  // The notice would otherwise sit there until a reload.
  useEffect(() => {
    if (state !== 'offline') return;
    let live = true;
    const recheck = () => check(() => live);
    window.addEventListener('online', recheck);
    return () => { live = false; window.removeEventListener('online', recheck); };
  }, [state, check]);

  if (state === 'loading') return <p className="hint" aria-busy="true">Loading…</p>;
  if (state === 'signedOut') return <SignIn onSignedIn={onSignedIn} />;
  return (
    <MeProvider me={me}>
      {state === 'offline' && <p className="banner" role="status">You're offline. Showing what's saved on this device.</p>}
      {children}
    </MeProvider>
  );
}
