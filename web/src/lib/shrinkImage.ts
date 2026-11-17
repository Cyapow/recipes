/**
 * Scales a photo down so its longest side is at most `maxSide` px and re-encodes it as JPEG (quality 0.9), honouring
 * the camera's orientation. Returns the original file when it is already small enough, or when the browser cannot
 * decode it (some browsers cannot read HEIC) or lacks the needed APIs, so a photo is never lost by shrinking.
 */
export async function shrinkImage(file: File, maxSide = 2000): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = bitmap;
    const longest = Math.max(width, height);
    if (longest <= maxSide) {
      bitmap.close?.();
      return file;
    }
    const scale = maxSide / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
