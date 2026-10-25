const isUsable = (ch: string) => /[\p{L}\p{N}]/u.test(ch);

/** Up to two uppercase initials for a recipe tile; one word gives its first two characters; nothing usable gives "?". */
export function monogram(title: string): string {
  const words = title
    .split(/\s+/)
    .map((w) => Array.from(w).slice(Array.from(w).findIndex(isUsable)).join(''))
    .filter((w) => w !== '' && isUsable(Array.from(w)[0]));
  if (words.length === 0) return '?';
  const raw = words.length === 1 ? Array.from(words[0]).slice(0, 2).join('') : Array.from(words[0])[0] + Array.from(words[1])[0];
  return Array.from(raw.toUpperCase()).slice(0, 2).join('');
}

const TILES = 5;

/** A stable palette pick for a title; values are CSS variables (--tile-N-bg/-fg) defined per theme in styles.css. */
export function monogramColors(title: string): { bg: string; fg: string } {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  const n = h % TILES;
  return { bg: `var(--tile-${n}-bg)`, fg: `var(--tile-${n}-fg)` };
}
