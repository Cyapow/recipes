import { useCallback, useEffect, useState } from 'react';

const KEY = 'keepScreenOn';

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

const isSupported = () => typeof navigator !== 'undefined' && !!navigator.wakeLock;

export function useWakeLock(): { supported: boolean; enabled: boolean; setEnabled(v: boolean): void } {
  const supported = isSupported();
  const [enabled, setEnabledState] = useState<boolean>(readStored);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      /* storage unavailable; keep in-memory state */
    }
  }, []);

  useEffect(() => {
    if (!enabled || !supported) return;
    let cancelled = false;
    let pending = false;
    let sentinel: WakeLockSentinel | null = null;

    const drop = () => {
      const s = sentinel;
      sentinel = null;
      s?.release().catch(() => {});
    };

    const acquire = async () => {
      if (cancelled || pending || sentinel || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const s = await navigator.wakeLock.request('screen');
        if (cancelled) {
          s.release().catch(() => {});
          return;
        }
        sentinel = s;
        s.addEventListener('release', () => {
          if (sentinel === s) sentinel = null;
        });
      } catch {
        /* denied (e.g. low battery); leave the preference as the user set it */
      } finally {
        pending = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
      else sentinel = null; // the browser auto-releases when hidden
    };
    const onPageHide = () => drop();
    const onPageShow = () => void acquire();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    void acquire();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      drop();
    };
  }, [enabled, supported]);

  return { supported, enabled, setEnabled };
}
