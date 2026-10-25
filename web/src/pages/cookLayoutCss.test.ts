// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// jsdom cannot evaluate media queries; this guards that the compact short-landscape layout stays wired up.
describe('styles.css short landscape cook layout', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const start = css.indexOf('@media (orientation: landscape) and (max-height: 520px)');
  const block = start < 0 ? '' : css.slice(start, css.indexOf('\n}\n', start));

  it('has the media query', () => expect(start).toBeGreaterThan(-1));
  it.each(['.cook-text', '.cook-uses', '.cook-nav', '.cook-nav button', '.cook-head .keep-on', '.cook-sheet-btn', '.cook-progress'])(
    'references %s', (sel) => expect(block).toContain(sel),
  );
  it('applies at every landscape width (no max-width cap) and comes after the tablet block', () => {
    const header = css.slice(start, css.indexOf('{', start));
    expect(header).not.toContain('max-width');
    expect(start).toBeGreaterThan(css.indexOf('@media (min-width: 900px) and (orientation: landscape)'));
  });
  it('gives every dvh declaration a preceding vh fallback', () => {
    for (const m of css.matchAll(/([a-z-]+): ([^;{}]*dvh[^;{}]*);/g)) {
      const prop = m[1];
      const before = css.slice(0, m.index);
      const lastDecl = before.slice(before.lastIndexOf(`${prop}:`));
      expect(lastDecl, m[0]).toMatch(/vh[^;]*;\s*$/);
      expect(lastDecl.includes('dvh'), m[0]).toBe(false);
    }
  });
  it('keeps text at least 22px and buttons at least 48px', () => {
    expect(block).toMatch(/\.cook-text[^{]*\{[^}]*font-size: 1\.5rem/);
    expect(block).toMatch(/\.cook-nav button \{ height: 5\dpx/);
  });
});
