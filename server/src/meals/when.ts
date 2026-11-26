export type StageWhen = { at: string; dayGroup: string; clock: string };

const WORDS = ['on the day', 'the day before', 'two days before'];

/** A calendar day as a day number, read in the server's timezone so a clock change cannot skew the difference. */
function dayNumber(d: Date): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/**
 * `at` is the ISO instant the stage happens; `dayGroup` is its calendar distance from the serving day and `clock`
 * its time of day ("23:30"), both in the server's timezone so a heading and the time under it always agree.
 */
export function stageWhen(serveAt: string, offsetMinutes: number): StageWhen {
  const serve = new Date(serveAt);
  const at = new Date(serve.getTime() - offsetMinutes * 60_000);
  // A stage that ends after serving would give a negative distance; it is still "on the day".
  const days = Math.max(0, dayNumber(serve) - dayNumber(at));
  return { at: at.toISOString(), clock: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at), dayGroup: WORDS[days] ?? `${days} days before` };
}

/** The serving time as a person would say it here, "Sunday 29 November 2026, 13:00", for the model to read. */
export function describeServeAt(serveAt: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
      .formatToParts(new Date(serveAt))
      .map((x) => [x.type, x.value]),
  );
  return `${p.weekday} ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}`;
}
