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
  it('skips leading punctuation and keeps at most two characters', () => {
    expect(monogram("(Mum's) soup")).toBe('MS');
    expect(monogram('5-min pasta')).toBe('5P');
    expect(monogram('--- !!!')).toBe('?');
    expect(monogram('ßeta')).toHaveLength(2);
  });
  it('handles emoji-only, non-Latin and whitespace titles', () => {
    expect(monogram('🍝🍝')).toBe('?');
    expect(monogram('Ċorba')).toBe('ĊO');
    expect(monogram('  \t ')).toBe('?');
    expect(monogram('  thai   curry ')).toBe('TC');
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
  it('references CSS variables and reaches all five palette entries', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = monogramColors(`recipe ${i}`);
      expect(c.bg).toMatch(/^var\(--tile-[0-4]-bg\)$/);
      expect(c.fg).toMatch(/^var\(--tile-[0-4]-fg\)$/);
      seen.add(c.bg);
    }
    expect(seen.size).toBe(5);
  });
  it('varies across titles', () => {
    const titles = ['Our spag bol', 'Sunday roast chicken', 'Thai green curry', 'Sourdough loaf', 'Lemon drizzle cake'];
    const bgs = new Set(titles.map((t) => monogramColors(t).bg));
    expect(bgs.size).toBeGreaterThanOrEqual(2);
  });
});
