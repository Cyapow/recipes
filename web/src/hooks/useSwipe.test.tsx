// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSwipe } from './useSwipe';

function Area({ onLeft, onRight, minDistance }: { onLeft(): void; onRight(): void; minDistance?: number }) {
  const swipe = useSwipe({ onLeft, onRight }, { minDistance });
  return <div data-testid="area" {...swipe} />;
}

const pt = (x: number, y: number) => ({ clientX: x, clientY: y });
function gesture(from: [number, number], to: [number, number]) {
  const el = screen.getByTestId('area');
  fireEvent.touchStart(el, { touches: [pt(...from)], changedTouches: [pt(...from)] });
  fireEvent.touchEnd(el, { touches: [], changedTouches: [pt(...to)] });
}

afterEach(cleanup);

describe('useSwipe', () => {
  it('fires onLeft for a mostly-horizontal leftward swipe', () => {
    const onLeft = vi.fn(), onRight = vi.fn();
    render(<Area onLeft={onLeft} onRight={onRight} />);
    gesture([200, 100], [120, 110]);
    expect(onLeft).toHaveBeenCalledTimes(1);
    expect(onRight).not.toHaveBeenCalled();
  });

  it('fires onRight for a rightward swipe', () => {
    const onLeft = vi.fn(), onRight = vi.fn();
    render(<Area onLeft={onLeft} onRight={onRight} />);
    gesture([100, 100], [190, 95]);
    expect(onRight).toHaveBeenCalledTimes(1);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it('ignores a diagonal/vertical-ish gesture', () => {
    const onLeft = vi.fn(), onRight = vi.fn();
    render(<Area onLeft={onLeft} onRight={onRight} />);
    gesture([200, 100], [120, 170]);
    expect(onLeft).not.toHaveBeenCalled();
    expect(onRight).not.toHaveBeenCalled();
  });

  it('ignores a short swipe', () => {
    const onLeft = vi.fn(), onRight = vi.fn();
    render(<Area onLeft={onLeft} onRight={onRight} />);
    gesture([200, 100], [170, 100]);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it('honours a custom minDistance', () => {
    const onLeft = vi.fn();
    render(<Area onLeft={onLeft} onRight={vi.fn()} minDistance={20} />);
    gesture([200, 100], [170, 100]);
    expect(onLeft).toHaveBeenCalledTimes(1);
  });

  it('ignores multi-touch gestures', () => {
    const onLeft = vi.fn(), onRight = vi.fn();
    render(<Area onLeft={onLeft} onRight={onRight} />);
    const el = screen.getByTestId('area');
    fireEvent.touchStart(el, { touches: [pt(200, 100), pt(250, 100)], changedTouches: [pt(200, 100)] });
    fireEvent.touchEnd(el, { touches: [], changedTouches: [pt(100, 100)] });
    expect(onLeft).not.toHaveBeenCalled();
    expect(onRight).not.toHaveBeenCalled();
  });

  it('ignores a gesture that became multi-touch after starting single', () => {
    const onLeft = vi.fn();
    render(<Area onLeft={onLeft} onRight={vi.fn()} />);
    const el = screen.getByTestId('area');
    fireEvent.touchStart(el, { touches: [pt(200, 100)], changedTouches: [pt(200, 100)] });
    fireEvent.touchStart(el, { touches: [pt(200, 100), pt(260, 100)], changedTouches: [pt(260, 100)] });
    fireEvent.touchEnd(el, { touches: [pt(200, 100)], changedTouches: [pt(100, 100)] });
    fireEvent.touchEnd(el, { touches: [], changedTouches: [pt(100, 100)] });
    expect(onLeft).not.toHaveBeenCalled();
  });
});
