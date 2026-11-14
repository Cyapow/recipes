import { describe, expect, it } from 'vitest';
import { formatPence, parseAmount, parsePence } from './money';

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

  it('parses pack sizes, turning kg and l into g and ml', () => {
    expect(parseAmount('3', '')).toBe(3);
    expect(parseAmount('0.5', '')).toBe(0.5);
    expect(parseAmount('1kg', 'g')).toBe(1000);
    expect(parseAmount('1.5 L', 'ml')).toBe(1500);
    expect(parseAmount('500g', 'g')).toBe(500);
  });
  it('rejects sizes that do not fit the unit', () => {
    for (const [t, u] of [['', ''], ['abc', ''], ['0', ''], ['1kg', 'ml'], ['1kg', ''], ['2 tins', 'tin'], ['500g', 'ml']] as const) {
      expect(parseAmount(t, u), `${t}/${u}`).toBeNull();
    }
  });
});
