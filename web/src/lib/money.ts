/** 1234 -> "£12.34" */
export const formatPence = (pence: number): string => `£${(pence / 100).toFixed(2)}`;

/** "1.50", "£1.5", "80p" -> pence; anything else (or zero or negative) -> null. */
export function parsePence(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/^£/, '');
  if (!t) return null;
  if (/^\d+p$/.test(t)) {
    const n = parseInt(t, 10);
    return n > 0 ? n : null;
  }
  if (!/^\d+(\.\d{1,2})?$|^\.\d{1,2}$/.test(t)) return null;
  const pence = Math.round(parseFloat(t) * 100);
  return pence > 0 ? pence : null;
}
