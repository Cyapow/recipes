// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useWakeLock } from './useWakeLock';

type Sentinel = EventTarget & { release: ReturnType<typeof vi.fn>; released: boolean };
let sentinels: Sentinel[];
let request: ReturnType<typeof vi.fn>;

function makeSentinel(): Sentinel {
  const s = new EventTarget() as Sentinel;
  s.released = false;
  s.release = vi.fn(async () => {
    s.released = true;
    s.dispatchEvent(new Event('release'));
  });
  sentinels.push(s);
  return s;
}
function setVisibility(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
}
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  sentinels = [];
  localStorage.clear();
  setVisibility('visible');
  request = vi.fn(async () => makeSentinel());
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (navigator as unknown as Record<string, unknown>).wakeLock;
});

describe('useWakeLock', () => {
  it('is off by default and requests nothing', async () => {
    const { result } = renderHook(() => useWakeLock());
    await flush();
    expect(result.current.supported).toBe(true);
    expect(result.current.enabled).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('requests once on enable and persists', async () => {
    const { result } = renderHook(() => useWakeLock());
    act(() => result.current.setEnabled(true));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('screen');
    expect(localStorage.getItem('keepScreenOn')).toBe('true');
  });

  it('releases on disable', async () => {
    const { result } = renderHook(() => useWakeLock());
    act(() => result.current.setEnabled(true));
    await flush();
    act(() => result.current.setEnabled(false));
    await flush();
    expect(sentinels[0].release).toHaveBeenCalled();
    expect(localStorage.getItem('keepScreenOn')).toBe('false');
  });

  it('releases on unmount', async () => {
    const { result, unmount } = renderHook(() => useWakeLock());
    act(() => result.current.setEnabled(true));
    await flush();
    unmount();
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('releases on pagehide', async () => {
    const { result } = renderHook(() => useWakeLock());
    act(() => result.current.setEnabled(true));
    await flush();
    window.dispatchEvent(new Event('pagehide'));
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('re-requests after hidden then visible while enabled', async () => {
    const { result } = renderHook(() => useWakeLock());
    act(() => result.current.setEnabled(true));
    await flush();
    // browser auto-releases when hidden
    sentinels[0].released = true;
    sentinels[0].dispatchEvent(new Event('release'));
    act(() => setVisibility('hidden'));
    expect(request).toHaveBeenCalledTimes(1);
    act(() => setVisibility('visible'));
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not re-request on visible while a lock is still held', async () => {
    const { result } = renderHook(() => useWakeLock());
    act(() => result.current.setEnabled(true));
    await flush();
    act(() => setVisibility('visible'));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not re-request on visible when disabled', async () => {
    const { result } = renderHook(() => useWakeLock());
    act(() => result.current.setEnabled(true));
    await flush();
    act(() => result.current.setEnabled(false));
    await flush();
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports unsupported without navigator.wakeLock', () => {
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
    const { result } = renderHook(() => useWakeLock());
    expect(result.current.supported).toBe(false);
    act(() => result.current.setEnabled(true));
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps enabled and does not throw when request rejects', async () => {
    request.mockRejectedValue(new DOMException('low battery', 'NotAllowedError'));
    const { result } = renderHook(() => useWakeLock());
    act(() => result.current.setEnabled(true));
    await flush();
    expect(result.current.enabled).toBe(true);
  });

  it('releases a lock that resolves after quick enable then disable', async () => {
    let resolve!: (s: Sentinel) => void;
    request.mockImplementationOnce(() => new Promise<Sentinel>((r) => (resolve = r)));
    const { result } = renderHook(() => useWakeLock());
    act(() => result.current.setEnabled(true));
    act(() => result.current.setEnabled(false));
    const s = makeSentinel();
    await act(async () => { resolve(s); });
    expect(s.release).toHaveBeenCalled();
  });

  it('restores enabled from localStorage and requests on mount', async () => {
    localStorage.setItem('keepScreenOn', 'true');
    const { result } = renderHook(() => useWakeLock());
    await flush();
    expect(result.current.enabled).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('survives localStorage throwing', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { result } = renderHook(() => useWakeLock());
    expect(result.current.enabled).toBe(false);
    act(() => result.current.setEnabled(true));
    await flush();
    expect(result.current.enabled).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
