/** Milliseconds until the next local-time `hour`:00. Exactly at the target means 24h later. */
export function msUntilNext(now: Date, hour: number): number {
  let target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  if (target.getTime() <= now.getTime()) {
    target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hour, 0, 0, 0);
  }
  return target.getTime() - now.getTime();
}

export function startBackupSchedule(o: {
  hour: number;
  run: () => Promise<void>;
  now?: () => Date;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (t: any) => void;
}): { stop(): void } {
  const now = o.now ?? (() => new Date());
  const setT = o.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = o.clearTimeoutFn ?? ((t) => clearTimeout(t));
  let stopped = false;
  let timer: unknown;

  const schedule = () => {
    if (stopped) return;
    timer = setT(async () => {
      timer = undefined;
      try {
        await o.run();
      } catch {
        // a failed run must never kill the schedule
      }
      schedule();
    }, msUntilNext(now(), o.hour));
  };
  schedule();
  return {
    stop() {
      stopped = true;
      if (timer !== undefined) clearT(timer);
      timer = undefined;
    },
  };
}
