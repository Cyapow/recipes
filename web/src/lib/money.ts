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

/**
 * A pack size typed by a person, in the ingredient's base unit: "3", "0.5", "500", and for weight and volume
 * "1kg" or "1.5l" (turned into g and ml). Empty or unreadable gives null.
 */
export function parseAmount(text: string, unit: string): number | null {
  const m = /^(\d*\.?\d+)\s*(kg|g|l|ml)?$/.exec(text.trim().toLowerCase());
  if (!m) return null;
  let n = parseFloat(m[1]!);
  const suffix = m[2];
  if (suffix === 'kg' || suffix === 'l') {
    if (unit !== (suffix === 'kg' ? 'g' : 'ml')) return null;
    n *= 1000;
  } else if (suffix && suffix !== unit) return null;
  return n > 0 ? n : null;
}
