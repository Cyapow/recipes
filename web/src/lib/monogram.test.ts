import { describe, expect, it } from 'vitest';
import { monogram, monogramColors } from './monogram';

describe('monogram', () => {
  it('uses up to two initials', () => {
    expect(monogram('Our spag bol')).toBe('OS');
    expect(monogram('Thai green curry')).toBe('TG');
  });
  it('uses the first two letters of a single word', () => {
    expect(monogram('sourdough')).toBe('SO');
    expect(monogram('x')).toBe('X');
  });
  it('falls back to ? when empty', () => {
    expect(monogram('')).toBe('?');
    expect(monogram('   ')).toBe('?');
  });
});

describe('monogramColors', () => {
  it('is stable for the same title', () => {
    expect(monogramColors('Our spag bol')).toEqual(monogramColors('Our spag bol'));
  });
  it('varies across titles', () => {
    const titles = ['Our spag bol', 'Sunday roast chicken', 'Thai green curry', 'Sourdough loaf', 'Lemon drizzle cake'];
    const bgs = new Set(titles.map((t) => monogramColors(t).bg));
    expect(bgs.size).toBeGreaterThanOrEqual(2);
  });
});
