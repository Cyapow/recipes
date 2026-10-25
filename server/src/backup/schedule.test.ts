process.env.TZ = 'Europe/London';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { msUntilNext, startBackupSchedule } from './schedule.js';

const H = 3600_000;

describe('msUntilNext', () => {
  it('04:00 -> next 03:00 is 23h', () => expect(msUntilNext(new Date(2026, 9, 25, 4, 0), 3)).toBe(23 * H));
  it('02:59 -> 1 minute', () => expect(msUntilNext(new Date(2026, 9, 25, 2, 59), 3)).toBe(60_000));
  it('exactly at target -> 24h', () => expect(msUntilNext(new Date(2026, 5, 1, 3, 0), 3)).toBe(24 * H));
  it('DST end (London 25 Oct 2026): the day is 25h long', () =>
    expect(msUntilNext(new Date(2026, 9, 24, 4, 0), 3)).toBe(24 * H));
  it('DST start (London 29 Mar 2026): the day is 23h long', () =>
    expect(msUntilNext(new Date(2026, 2, 28, 4, 0), 3)).toBe(22 * H));
});

describe('startBackupSchedule', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (run: () => Promise<void>) => {
    vi.setSystemTime(new Date(2026, 5, 1, 2, 0));
    return startBackupSchedule({ hour: 3, run });
  };

  it('runs at the hour and reschedules', async () => {
    const run = vi.fn(async () => {});
    setup(run);
    await vi.advanceTimersByTimeAsync(H - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24 * H);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('survives a throwing run', async () => {
    const run = vi.fn(async () => { throw new Error('x'); });
    setup(run);
    await vi.advanceTimersByTimeAsync(H + 24 * H);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('stop() before firing cancels', async () => {
    const run = vi.fn(async () => {});
    setup(run).stop();
    await vi.advanceTimersByTimeAsync(48 * H);
    expect(run).not.toHaveBeenCalled();
  });

  it('stop() during an in-flight run prevents rescheduling', async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const s = setup(run);
    await vi.advanceTimersByTimeAsync(H);
    expect(run).toHaveBeenCalledTimes(1);
    s.stop();
    release();
    await vi.advanceTimersByTimeAsync(72 * H);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('accepts injected timer functions', () => {
    const calls: number[] = [];
    startBackupSchedule({
      hour: 3, run: async () => {}, now: () => new Date(2026, 5, 1, 2, 0),
      setTimeoutFn: (_fn, ms) => { calls.push(ms); return 1; },
    });
    expect(calls).toEqual([H]);
  });
});
