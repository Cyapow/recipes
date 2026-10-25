// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RecipeOverview } from './RecipeOverview';
import type { Recipe } from '../api';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, getRecipe: vi.fn(), addToShopping: vi.fn() };
});
import { addToShopping, ApiError, getRecipe } from '../api';

const base: Recipe = {
  id: 'a', title: 'Carbonara', description: '', origin: 'mine', sourceName: null, sourceUrl: null,
  servings: 2, prepMinutes: 5, cookMinutes: 70,
  ingredients: [
    { group: null, quantity: 200, unit: 'g', item: 'spaghetti', note: null },
    { group: null, quantity: 3, unit: null, item: 'eggs', note: null },
  ],
  steps: [], notes: '', tags: [], imageIds: [], createdAt: '', updatedAt: 'v1',
};

function renderOverview() {
  return render(
    <MemoryRouter initialEntries={['/recipe/a']}>
      <Routes>
        <Route path="/recipe/:id" element={<RecipeOverview />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(getRecipe).mockReset().mockResolvedValue(base);
  vi.mocked(addToShopping).mockReset().mockResolvedValue({ added: 2 });
});
afterEach(cleanup);

describe('RecipeOverview servings', () => {
  it.each([
    [null, null],
    [1, '1 serving'],
    [4, '4 servings'],
    [2.5, '2.5 servings'],
  ])('servings %s shows %s', async (servings, expected) => {
    vi.mocked(getRecipe).mockResolvedValue({ ...base, servings });
    renderOverview();
    await screen.findByRole('heading', { name: 'Carbonara' });
    const sub = document.querySelector('.sub')!;
    if (expected === null) {
      expect(sub.textContent).not.toMatch(/serving|null/);
      expect(sub.textContent).toContain('Prep');
    } else {
      expect(sub.textContent).toContain(expected);
      expect(sub.textContent).not.toMatch(/1 servings/);
    }
  });
});

describe('RecipeOverview recipe_changed', () => {
  const changed = () => new ApiError('x', 409, { error: 'recipe_changed' });

  it('sends the loaded updatedAt', async () => {
    const user = userEvent.setup();
    renderOverview();
    await user.click(await screen.findByRole('button', { name: 'Add 2 to shopping list' }));
    expect(addToShopping).toHaveBeenCalledWith('a', [0, 1], undefined, 'v1');
  });

  it('shows the message and Reload, never auto-adds, and Reload refetches and resets ticks', async () => {
    const user = userEvent.setup();
    renderOverview();
    await user.click(await screen.findByRole('checkbox', { name: /spaghetti/ }));
    vi.mocked(addToShopping).mockRejectedValueOnce(changed());
    await user.click(screen.getByRole('button', { name: 'Add 1 to shopping list' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This recipe was changed on another device. Reload to see the latest ingredients.');
    expect(addToShopping).toHaveBeenCalledTimes(1);

    vi.mocked(getRecipe).mockResolvedValue({
      ...base, updatedAt: 'v2',
      ingredients: [{ group: null, quantity: 1, unit: null, item: 'pancetta', note: null }],
    });
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await screen.findByRole('checkbox', { name: /pancetta/ });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('0 of 1 ticked')).toBeTruthy();
    expect(addToShopping).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Add 1 to shopping list' }));
    expect(addToShopping).toHaveBeenLastCalledWith('a', [0], undefined, 'v2');
  });

  it('the forced retry after already_on_list still sends expectedUpdatedAt', async () => {
    const user = userEvent.setup();
    renderOverview();
    vi.mocked(addToShopping).mockRejectedValueOnce(new ApiError('x', 409, { error: 'already_on_list', recipeTitle: 'Carbonara' }));
    await user.click(await screen.findByRole('button', { name: 'Add 2 to shopping list' }));
    await user.click(await screen.findByRole('button', { name: 'Add again' }));
    await waitFor(() => expect(addToShopping).toHaveBeenCalledTimes(2));
    expect(addToShopping).toHaveBeenLastCalledWith('a', [0, 1], true, 'v1');
  });

  it('recipe_changed is not shown as the duplicate prompt', async () => {
    const user = userEvent.setup();
    renderOverview();
    vi.mocked(addToShopping).mockRejectedValueOnce(changed());
    await user.click(await screen.findByRole('button', { name: 'Add 2 to shopping list' }));
    await screen.findByRole('button', { name: 'Reload' });
    expect(screen.queryByRole('button', { name: 'Add again' })).toBeNull();
  });
});
