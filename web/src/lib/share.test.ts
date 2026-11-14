import { describe, expect, it, vi } from 'vitest';
import { shareText, shoppingShareText } from './share';

const abort = () => Object.assign(new Error('dismissed'), { name: 'AbortError' });

describe('shoppingShareText', () => {
  it('puts items for another shop under a heading with its name', () => {
    const items = [
      { text: '500g beef shin', section: 'Butcher' }, { text: '2 onions', section: 'shop' }, { text: '1 loaf', section: 'Baker' },
      { text: '1kg shin bones', section: 'Butcher' },
    ];
    expect(shoppingShareText(items)).toBe('2 onions\n\nButcher:\n500g beef shin\n1kg shin bones\n\nBaker:\n1 loaf');
    expect(shoppingShareText([items[0]!])).toBe('Butcher:\n500g beef shin');
  });

  it('puts one text per line with no bullets or trailing blank line', () => {
    const items = [{ text: '2 tins chopped tomatoes' }, { text: '500g beef mince' }] as never[];
    expect(shoppingShareText(items)).toBe('2 tins chopped tomatoes\n500g beef mince');
  });
  it('is empty for no items', () => {
    expect(shoppingShareText([])).toBe('');
  });
});

describe('shareText', () => {
  it('shares text only and reports shared', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    expect(await shareText('a', { share, clipboard: { writeText } } as never)).toBe('shared');
    expect(share).toHaveBeenCalledWith({ text: 'a' });
    expect(writeText).not.toHaveBeenCalled();
  });
  it('treats AbortError as cancelled, with no clipboard fallback', async () => {
    const share = vi.fn().mockRejectedValue(abort());
    const writeText = vi.fn();
    expect(await shareText('a', { share, clipboard: { writeText } } as never)).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });
  it('falls back to the clipboard when share is unsupported', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareText('a', { clipboard: { writeText } } as never)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('a');
  });
  it('falls back to the clipboard when share rejects with another error', async () => {
    const share = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareText('a', { share, clipboard: { writeText } } as never)).toBe('copied');
  });
  it('reports manual when the clipboard rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    expect(await shareText('a', { clipboard: { writeText } } as never)).toBe('manual');
  });
  it('reports manual when nothing is available', async () => {
    expect(await shareText('a', {} as never)).toBe('manual');
  });
});
