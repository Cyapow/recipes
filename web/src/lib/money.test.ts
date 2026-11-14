import { describe, expect, it } from 'vitest';
import { formatPence, parsePence } from './money';

describe('money', () => {
  it('formats pence as pounds', () => {
    expect(formatPence(0)).toBe('£0.00');
    expect(formatPence(80)).toBe('£0.80');
    expect(formatPence(13005)).toBe('£130.05');
  });
  it('parses what people type', () => {
    expect(parsePence('1.50')).toBe(150);
    expect(parsePence('£2')).toBe(200);
    expect(parsePence(' .8 ')).toBe(80);
    expect(parsePence('80p')).toBe(80);
    expect(parsePence('0.1 ')).toBe(10);
  });
  it('rejects nonsense, zero and negatives', () => {
    for (const bad of ['', 'abc', '0', '0.00', '-1', '1.234', '1,50', '0p']) expect(parsePence(bad), bad).toBeNull();
  });
});
