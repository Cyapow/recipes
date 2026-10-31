import qrcode from 'qrcode-generator';

/**
 * The dark/light grid of a QR code, row by row. Type number 0 picks the smallest size that fits the text;
 * error correction M keeps the code readable when the print smudges or the paper creases.
 */
export function qrModules(text: string): boolean[][] {
  if (text === '') throw new Error('qrModules needs text to encode');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  return Array.from({ length: count }, (_, r) => Array.from({ length: count }, (_, c) => qr.isDark(r, c)));
}

/** One 1x1 square per dark module, as SVG path data drawn on a viewBox the size of the grid. */
export function qrPathData(modules: boolean[][]): string {
  let d = '';
  modules.forEach((row, r) => row.forEach((dark, c) => {
    if (dark) d += `M${c} ${r}h1v1h-1z`;
  }));
  return d;
}
