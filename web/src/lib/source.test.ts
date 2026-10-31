import { describe, expect, it } from 'vitest';
import { sourceLink } from './source';

const recipe = (sourceUrl: string | null, sourceName: string | null = null) => ({ sourceUrl, sourceName });

describe('sourceLink', () => {
  it('is null when the recipe has no source URL', () => {
    expect(sourceLink(recipe(null, 'Mum'))).toBeNull();
  });

  it('offers to open the original page at its host', () => {
    expect(sourceLink(recipe('https://www.bbcgoodfood.com/recipes/pancakes'))).toEqual({
      href: 'https://www.bbcgoodfood.com/recipes/pancakes',
      host: 'bbcgoodfood.com',
      label: 'View original at bbcgoodfood.com',
      video: false,
    });
  });

  it('prefers the stored source name over the host', () => {
    const link = sourceLink(recipe('https://www.bbcgoodfood.com/r/1', 'BBC Good Food'));
    expect(link?.label).toBe('View original at BBC Good Food');
    expect(link?.host).toBe('bbcgoodfood.com');
  });

  it('calls a social video post a video to watch', () => {
    const link = sourceLink(recipe('https://www.facebook.com/reel/1301954275439576/'));
    expect(link).toMatchObject({ video: true, label: 'Watch on facebook.com' });
  });

  it.each([
    'https://www.instagram.com/reel/abc/',
    'https://www.tiktok.com/@cook/video/123',
    'https://www.youtube.com/watch?v=abc',
    'https://youtu.be/abc',
  ])('treats %s as a video', (url) => {
    expect(sourceLink(recipe(url))?.video).toBe(true);
  });

  it('refuses a URL that is not http(s), so a stored javascript: link can never be opened', () => {
    expect(sourceLink(recipe('javascript:alert(1)'))).toBeNull();
    expect(sourceLink(recipe('not a url'))).toBeNull();
  });
});
