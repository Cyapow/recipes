export type TagGroup = 'cuisine' | 'meal' | 'main' | 'other';

export const TAG_GROUPS: readonly { id: TagGroup; label: string }[] = [
  { id: 'cuisine', label: 'Cuisine' },
  { id: 'meal', label: 'Meal' },
  { id: 'main', label: 'Main ingredient' },
  { id: 'other', label: 'Other' },
];

export type Tag = { group: TagGroup; name: string };

export const KNOWN_BRANDS = ['Mine', 'HelloFresh', 'Gousto', 'Simply Cook'] as const;

const looseKey = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '');

/** Trimmed brand with the canonical spelling for known brands; blank becomes null. */
export function canonicalBrand(s: string | null | undefined): string | null {
  const t = typeof s === 'string' ? s.trim() : '';
  if (!t) return null;
  const key = looseKey(t);
  return KNOWN_BRANDS.find((b) => looseKey(b) === key) ?? t;
}

export function originForBrand(b: string | null): 'mine' | 'other' {
  return b === 'Mine' ? 'mine' : 'other';
}

const GROUP_IDS = new Set<string>(TAG_GROUPS.map((g) => g.id));

/**
 * Normalise stored or submitted tags into a valid Tag[]: strings become `other` tags, unreadable entries
 * are dropped, names are trimmed, duplicates (same group, case-insensitive name) keep the first. Never throws.
 */
export function normaliseTags(raw: unknown): Tag[] {
  if (!Array.isArray(raw)) return [];
  const out: Tag[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    let group: TagGroup | null = null;
    let name = '';
    if (typeof entry === 'string') {
      group = 'other';
      name = entry;
    } else if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      if (typeof e.group === 'string' && GROUP_IDS.has(e.group) && typeof e.name === 'string') {
        group = e.group as TagGroup;
        name = e.name;
      }
    }
    name = name.trim();
    if (!group || !name) continue;
    const key = `${group}:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ group, name });
  }
  return out;
}

export function tagKey(t: Tag): string {
  return `${t.group}:${t.name}`;
}

/** Inverse of tagKey: splits on the first colon only, so names may contain colons. */
export function parseTagKey(s: string): Tag | null {
  const i = s.indexOf(':');
  if (i < 0) return null;
  const group = s.slice(0, i);
  const name = s.slice(i + 1);
  if (!GROUP_IDS.has(group) || !name) return null;
  return { group: group as TagGroup, name };
}
