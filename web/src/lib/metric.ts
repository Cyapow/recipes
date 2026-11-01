import { useEffect, useState } from 'react';

/**
 * Whether to show amounts in metric, remembered per device the way the theme and the screen lock are. Off by
 * default: a recipe is shown as it was written until you ask for otherwise.
 */
const KEY = 'recipes.metric';
const listeners = new Set<(on: boolean) => void>();

export function getMetric(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setMetric(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // blocked storage: the choice just won't be remembered
  }
  for (const l of listeners) l(on);
}

/** The preference, kept in step across every view showing it, so the two toggles never disagree. */
export function useMetric(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(getMetric);
  useEffect(() => {
    listeners.add(setOn);
    return () => {
      listeners.delete(setOn);
    };
  }, []);
  return [on, setMetric];
}
