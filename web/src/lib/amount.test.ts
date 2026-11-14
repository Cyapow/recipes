import { describe, expect, it } from 'vitest';
import { formatAmount } from './amount';

describe('formatAmount', () => {
  it('formats by unit', () => {
    expect(formatAmount(4, '')).toBe('4');
    expect(formatAmount(800, 'g')).toBe('800g');
    expect(formatAmount(1500, 'g')).toBe('1.5kg');
    expect(formatAmount(250, 'ml')).toBe('250ml');
    expect(formatAmount(2, 'tin')).toBe('2 tins');
    expect(formatAmount(1, 'tin')).toBe('1 tin');
  });
});
