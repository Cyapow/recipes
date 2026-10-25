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
  it('keeps text at least 22px and buttons at least 48px', () => {
    expect(block).toMatch(/\.cook-text[^{]*\{[^}]*font-size: 1\.5rem/);
    expect(block).toMatch(/\.cook-nav button \{ height: 5\dpx/);
  });
});
