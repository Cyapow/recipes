// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RecipeFace, subtitle } from './RecipeFace';
import type { RecipeSummary } from '../api';

const recipe: RecipeSummary = {
  id: 'r1', title: 'Cottage pie', origin: 'mine', brand: null, sourceName: null,
  tags: [], thumbnailId: null, totalMinutes: null, favouritedBy: [],
};

afterEach(cleanup);

describe('RecipeFace', () => {
  it('shows the recipe photo when it has one', () => {
    render(<RecipeFace recipe={{ ...recipe, thumbnailId: 'img1' }} />);
    const img = screen.getByRole('presentation') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/images/img1/thumb');
  });

  it('falls back to the monogram when it has none', () => {
    render(<RecipeFace recipe={recipe} />);
    expect(screen.getByText('CP')).toBeTruthy();
    expect(screen.queryByRole('presentation')).toBeNull();
  });

  it('reads origin, first tag and total time into the subtitle', () => {
    expect(subtitle({ ...recipe, tags: [{ group: 'meal', name: 'Dinner' }], totalMinutes: 70 })).toBe('Mine · Dinner · 1h 10m');
  });

  it('leaves out what a recipe does not have', () => {
    expect(subtitle(recipe)).toBe('Mine');
  });
});
