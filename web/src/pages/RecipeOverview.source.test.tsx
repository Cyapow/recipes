// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RecipeOverview } from './RecipeOverview';
import type { Recipe } from '../api';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, getRecipe: vi.fn(), addToShopping: vi.fn() };
});
import { getRecipe } from '../api';

const base: Recipe = {
  id: 'a', title: 'Mini pizza stacks', description: '', origin: 'other', sourceName: null, sourceUrl: null,
  servings: 6, prepMinutes: null, cookMinutes: null,
  ingredients: [{ group: null, quantity: 330, unit: 'g', item: 'plain flour', note: null }],
  steps: [], notes: '', tags: [], imageIds: [], createdAt: '', updatedAt: 'v1',
};

const show = (r: Partial<Recipe>) => {
  vi.mocked(getRecipe).mockResolvedValue({ ...base, ...r });
  return render(
    <MemoryRouter initialEntries={['/recipe/a']}>
      <Routes>
        <Route path="/recipe/:id" element={<RecipeOverview />} />
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  vi.mocked(getRecipe).mockReset();
});
afterEach(cleanup);

describe('the source of an imported recipe', () => {
  it('links out to the page it came from', async () => {
    show({ sourceUrl: 'https://www.slowcookerclub.com/chilli/', sourceName: 'slowcookerclub.com' });
    const link = await screen.findByRole('link', { name: /View original at slowcookerclub\.com/ });
    expect(link).toHaveProperty('href', 'https://www.slowcookerclub.com/chilli/');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('shows a video post as its thumbnail, so you can see what you are opening', async () => {
    show({ sourceUrl: 'https://www.facebook.com/reel/1301954275439576/', sourceName: 'facebook.com', imageIds: ['img1'] });
    const link = await screen.findByRole('link', { name: /Watch on facebook\.com/ });
    expect(link.querySelector('img')).toHaveProperty('src', expect.stringContaining('/api/images/img1'));
  });

  it('still offers the video link when the post had no thumbnail', async () => {
    show({ sourceUrl: 'https://www.facebook.com/reel/1/', sourceName: 'facebook.com', imageIds: [] });
    expect(await screen.findByRole('link', { name: /Watch on facebook\.com/ })).toBeTruthy();
  });

  it('says nothing about a source for a recipe of your own', async () => {
    show({ origin: 'mine', sourceUrl: null });
    await screen.findByRole('heading', { name: 'Mini pizza stacks' });
    expect(screen.queryByRole('link', { name: /View original|Watch on/ })).toBeNull();
  });
});
