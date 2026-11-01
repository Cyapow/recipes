import { describe, expect, it, vi } from 'vitest';
import { firstLink, sourceFromText } from './describedSource.js';

const pasted = `From URL
https://www.facebook.com/share/r/1CXPhAtkLT/

Save this. Melt-in-your-mouth Pot Roast (recipe below)
Ingredients:
3lb boneless chuck roast
2.5-3 cups @kettleandfire bone broth
#quickrecipes #potroast`;

describe('firstLink', () => {
  it('finds the link someone pasted above their recipe', () => {
    expect(firstLink(pasted)).toBe('https://www.facebook.com/share/r/1CXPhAtkLT/');
  });
  it('is not fooled by a handle, a hashtag or a bare domain word', () => {
    expect(firstLink('2 cups @kettleandfire bone broth #potroast')).toBeNull();
    expect(firstLink('from bbcgoodfood.com, roughly')).toBeNull();
  });
  it('takes the first of several', () => {
    expect(firstLink('see https://a.test/one and https://b.test/two')).toBe('https://a.test/one');
  });
  it('leaves trailing punctuation out of the link', () => {
    expect(firstLink('from https://a.test/pot-roast.')).toBe('https://a.test/pot-roast');
    expect(firstLink('(https://a.test/x), tasty')).toBe('https://a.test/x');
  });
  it('only follows http and https', () => {
    expect(firstLink('javascript:alert(1) and file:///etc/passwd')).toBeNull();
  });
  it('says nothing about text with no link at all', () => {
    expect(firstLink('Nan’s spag bol, roughly how she made it')).toBeNull();
  });
});

const deps = (over: Partial<Parameters<typeof sourceFromText>[1]> = {}) => ({
  fetchPage: vi.fn(async () => ({ html: '<meta property="og:image" content="https://x.test/pot.jpg">', finalUrl: 'https://www.facebook.com/reel/99/' })),
  fetchBytes: vi.fn(async () => ({ bytes: Buffer.from('img'), contentType: 'image/jpeg', finalUrl: 'x' })),
  images: { save: vi.fn(async () => 'a'.repeat(64) + '.jpg'), path: vi.fn(), dir: '/x' },
  ...over,
});

describe('sourceFromText', () => {
  it('takes the photo and the source from the page the text links to', async () => {
    const d = deps();
    expect(await sourceFromText(pasted, d)).toEqual({
      imageIds: ['a'.repeat(64) + '.jpg'],
      sourceUrl: 'https://www.facebook.com/reel/99/',
      sourceName: 'facebook.com',
    });
    expect(d.fetchBytes).toHaveBeenCalledWith('https://x.test/pot.jpg');
  });
  it('leaves a description with no link exactly as it was', async () => {
    const d = deps();
    expect(await sourceFromText('Nan’s spag bol', d)).toBeNull();
    expect(d.fetchPage).not.toHaveBeenCalled();
  });
  it('still records where it came from when the page has no photo', async () => {
    const d = deps({ fetchPage: vi.fn(async () => ({ html: '<p>no image here</p>', finalUrl: 'https://a.test/x' })) });
    expect(await sourceFromText(pasted, d)).toEqual({ imageIds: [], sourceUrl: 'https://a.test/x', sourceName: 'a.test' });
  });
  it('gives up quietly when the page cannot be fetched, rather than failing the recipe', async () => {
    const d = deps({ fetchPage: vi.fn(async () => { throw new Error('blocked'); }) });
    expect(await sourceFromText(pasted, d)).toBeNull();
  });
});
