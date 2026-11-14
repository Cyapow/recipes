import type { ShoppingItem } from '../api';

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'manual';

/** One item per line, no bullets, no trailing blank line. Butcher items follow under their own heading. */
export function shoppingShareText(items: (Pick<ShoppingItem, 'text'> & { section?: 'shop' | 'butcher' })[]): string {
  const lines = (list: typeof items) => list.map((i) => i.text).join('\n');
  const shop = items.filter((i) => i.section !== 'butcher');
  const butcher = items.filter((i) => i.section === 'butcher');
  if (butcher.length === 0) return lines(shop);
  return `${shop.length ? `${lines(shop)}\n\n` : ''}From the butcher:\n${lines(butcher)}`;
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
