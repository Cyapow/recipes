// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RecipeOverview } from './RecipeOverview';
import { setMetric } from '../lib/metric';
import type { Recipe } from '../api';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, getRecipe: vi.fn(), addToShopping: vi.fn() };
});
import { getRecipe } from '../api';

const base: Recipe = {
  id: 'a', title: 'Meatloaf', description: '', origin: 'other', sourceName: null, sourceUrl: null,
  servings: 4, prepMinutes: null, cookMinutes: null,
  ingredients: [], steps: [], notes: '', tags: [], imageIds: [], createdAt: '', updatedAt: 'v1',
};
const ing = (quantity: number | null, unit: string | null, item: string) =>
  ({ group: null, quantity, unit, item, note: null });

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
  setMetric(false);
  localStorage.clear();
});
afterEach(cleanup);

describe('showing an American recipe in metric', () => {
  it('switches the amounts when asked, and leaves the cups alone', async () => {
    show({ ingredients: [ing(1, 'lb', 'ground beef'), ing(2, 'cups', 'breadcrumbs')] });
    expect(await screen.findByText('1 lb')).toBeTruthy();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Show amounts in metric' }));

    expect(screen.getByText('450g')).toBeTruthy();
    expect(screen.queryByText('1 lb')).toBeNull();
    expect(screen.getByText('2 cups')).toBeTruthy(); // a cup is a cup: we own the measuring cups
  });
  it('offers no switch on a recipe already written in metric', async () => {
    show({ ingredients: [ing(500, 'g', 'beef mince'), ing(2, 'cups', 'flour')] });
    await screen.findByRole('heading', { name: 'Meatloaf' });
    expect(screen.queryByRole('checkbox', { name: 'Show amounts in metric' })).toBeNull();
  });
  it('remembers the choice for the next recipe you open', async () => {
    setMetric(true);
    show({ ingredients: [ing(2, 'lb', 'chicken tenders')] });
    expect(await screen.findByText('910g')).toBeTruthy();
  });
});
