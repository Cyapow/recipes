import { describe, expect, it } from 'vitest';
import { qrModules, qrPathData } from './qr';

const URL = 'https://recipes.matchapman.dev/recipe/abc123';

describe('qrModules', () => {
  it('returns a square grid of at least the smallest QR size', () => {
    const m = qrModules(URL);
    expect(m.length).toBeGreaterThanOrEqual(21);
    for (const row of m) expect(row.length).toBe(m.length);
  });

  it('draws the three finder squares scanners look for', () => {
    const m = qrModules(URL);
    const last = m.length - 1;
    // Each finder is a 7x7 dark ring: the corner module is dark, the module just inside the ring is not.
    for (const [r, c] of [[0, 0], [0, last - 6], [last - 6, 0]] as const) {
      expect(m[r]![c]).toBe(true);
      expect(m[r + 1]![c + 1]).toBe(false);
    }
  });

  it('encodes different text differently', () => {
    expect(qrModules(`${URL}/a`)).not.toEqual(qrModules(`${URL}/b`));
  });

  it('refuses empty text rather than drawing a meaningless code', () => {
    expect(() => qrModules('')).toThrow();
  });
});

describe('qrPathData', () => {
  it('draws one unit square per dark module', () => {
    const d = qrPathData([
      [true, false],
      [false, true],
    ]);
    expect(d).toBe('M0 0h1v1h-1zM1 1h1v1h-1z');
  });

  it('is empty when nothing is dark', () => {
    expect(qrPathData([[false, false], [false, false]])).toBe('');
  });
});
