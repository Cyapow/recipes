import type { ShoppingItem } from '../api';

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'manual';

/**
 * One item per line, no bullets, no trailing blank line. Items for another shop follow under a heading with
 * that shop's name, in the order the shops first appear.
 */
export function shoppingShareText(items: (Pick<ShoppingItem, 'text'> & { section?: string })[]): string {
  const lines = (list: typeof items) => list.map((i) => i.text).join('\n');
  const isDefault = (i: { section?: string }) => !i.section || i.section === 'shop';
  const blocks = [lines(items.filter(isDefault))].filter(Boolean);
  const others = new Map<string, typeof items>();
  for (const i of items.filter((x) => !isDefault(x))) others.set(i.section!, [...(others.get(i.section!) ?? []), i]);
  for (const [name, list] of others) blocks.push(`${name}:\n${lines(list)}`);
  return blocks.join('\n\n');
}

/**
 * Share via the system sheet, else the clipboard, else tell the caller to show the text.
 * Dismissing the sheet (AbortError) is a cancel, not a failure: no fallback, no error.
 */
export async function shareText(
  text: string,
  nav: Partial<Pick<Navigator, 'share' | 'clipboard'>> = navigator,
): Promise<ShareOutcome> {
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ text });
      return 'shared';
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
      if ((e as { name?: string } | null)?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    if (!nav.clipboard?.writeText) return 'manual';
    await nav.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'manual';
  }
}
