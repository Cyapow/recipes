/** Up to two uppercase initials for a recipe tile; one word gives its first two letters; empty gives "?". */
export function monogram(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? Array.from(words[0]).slice(0, 2) : [Array.from(words[0])[0], Array.from(words[1])[0]];
  return letters.join('').toUpperCase();
}

// Tile palette from the approved library mockup.
const PALETTE: { bg: string; fg: string }[] = [
  { bg: '#F3D9C6', fg: '#7A2F14' },
  { bg: '#F6E3B8', fg: '#6B4A0B' },
  { bg: '#D6E4CF', fg: '#2F4A29' },
  { bg: '#EBDCC8', fg: '#5B4326' },
  { bg: '#F5EBB5', fg: '#625511' },
];

/** A stable palette pick for a title: the same title always gets the same colours. */
export function monogramColors(title: string): { bg: string; fg: string } {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return { ...PALETTE[h % PALETTE.length] };
}
