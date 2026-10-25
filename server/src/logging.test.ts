import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { loggerOptions } from './logging.js';

describe('loggerOptions', () => {
  it('is off under vitest', () => {
    expect(loggerOptions({ VITEST: 'true' })).toBe(false);
  });
  it('defaults to warn and honours LOG_LEVEL', () => {
    expect((loggerOptions({}) as { level: string }).level).toBe('warn');
    expect((loggerOptions({ LOG_LEVEL: 'error' }) as { level: string }).level).toBe('error');
  });
  it('strips query strings and redacts auth headers and cookies', () => {
    let out = '';
    const sink = new Writable({ write(c, _e, cb) { out += c; cb(); } });
    const opts = loggerOptions({}) as Exclude<ReturnType<typeof loggerOptions>, false>;
    const log = pino(opts, sink);
    log.error(
      { req: { method: 'GET', url: '/api/backup/google/callback?code=SECRETCODE&state=SECRETSTATE', headers: { cookie: 'recipes_oauth_state=SECRETSTATE', authorization: 'Bearer SECRETTOKEN' } } },
      'boom',
    );
    expect(out).toContain('/api/backup/google/callback');
    for (const secret of ['SECRETCODE', 'SECRETSTATE', 'SECRETTOKEN']) expect(out).not.toContain(secret);
  });
});
