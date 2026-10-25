import { describe, expect, it } from 'vitest';
import { describeError } from './run.js';

const AUTH = 'Google Drive authorisation failed - reconnect Drive';

describe('describeError', () => {
  it.each([
    ['code 401', { code: 401 }],
    ["code '401'", { code: '401' }],
    ['code invalid_grant', { code: 'invalid_grant' }],
    ['response.status 401', { response: { status: 401 } }],
    ['response.data.error invalid_grant', { response: { data: { error: 'invalid_grant' } } }],
    ['message invalid_grant', new Error('boom invalid_grant: Token expired')],
  ])('recognises auth failure via %s', (_n, e) => expect(describeError(e)).toBe(AUTH));

  it('scrubs urls, tokens and bearer headers, then truncates', () => {
    const s = describeError(new Error('GET https://www.googleapis.com/x?access_token=abc failed ya29.a0-AfH_x 1//0gABC-d Bearer sekret.value done'));
    expect(s).not.toMatch(/https?:|ya29|1\/\/0|sekret/);
    expect(s).toContain('failed');
    expect(describeError(new Error('x'.repeat(500))).length).toBe(200);
  });

  it('falls back for empty messages', () => expect(describeError(new Error(''))).toBe('Backup failed'));
});
