// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shrinkImage } from './shrinkImage';

const file = new File(['x'], 'card.heic', { type: 'image/heic' });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shrinkImage', () => {
  it('returns the original file when the browser cannot decode it', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('cannot decode')));
    expect(await shrinkImage(file)).toBe(file);
  });

  it('returns the original file when createImageBitmap is missing', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    expect(await shrinkImage(file)).toBe(file);
  });

  it('returns the original file when it is already within the limit', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1500, height: 2000, close() {} }));
    expect(await shrinkImage(file)).toBe(file);
  });

  it('scales a large photo down to a JPEG with the longest side at the limit', async () => {
    const create = vi.fn().mockResolvedValue({ width: 4000, height: 3000, close() {} });
    vi.stubGlobal('createImageBitmap', create);
    const draw = vi.fn();
    let size = { w: 0, h: 0 };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      size = { w: this.width, h: this.height };
      return { drawImage: draw } as unknown as CanvasRenderingContext2D;
    } as never);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb, type, q) => {
      expect(type).toBe('image/jpeg');
      expect(q).toBe(0.9);
      cb(new Blob(['j'], { type: 'image/jpeg' }));
    });
    const out = await shrinkImage(file);
    expect(create).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(size).toEqual({ w: 2000, h: 1500 });
    expect(draw).toHaveBeenCalled();
    expect(toBlob).toHaveBeenCalled();
    expect(out).not.toBe(file);
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('card.jpg');
  });
});
