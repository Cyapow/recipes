import { useCallback, useRef, type TouchEvent } from 'react';

/**
 * Horizontal swipe detection for touch devices. Fires only for mostly-horizontal,
 * single-finger gestures (|dx| >= minDistance and |dx| > 1.5 * |dy|), so vertical
 * scrolling and pinch gestures are unaffected. Swipe left = onLeft, right = onRight.
 */
export function useSwipe(
  handlers: { onLeft(): void; onRight(): void },
  opts: { minDistance?: number } = {},
): { onTouchStart(e: TouchEvent): void; onTouchEnd(e: TouchEvent): void } {
  const minDistance = opts.minDistance ?? 60;
  const start = useRef<{ x: number; y: number } | null>(null);
  const multi = useRef(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 1) {
      start.current = null;
      // A second finger invalidates the whole gesture until all fingers lift.
      multi.current = true;
      return;
    }
    if (multi.current) return;
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);

  const onTouchEnd = useCallback((e: TouchEvent) => {
    const s = start.current;
    start.current = null;
    if (e.touches.length > 0) return;
    const wasMulti = multi.current;
    multi.current = false;
    const t = e.changedTouches[0];
    if (!s || wasMulti || !t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < minDistance || Math.abs(dx) <= 1.5 * Math.abs(dy)) return;
    if (dx < 0) handlersRef.current.onLeft();
    else handlersRef.current.onRight();
  }, [minDistance]);

  return { onTouchStart, onTouchEnd };
}
