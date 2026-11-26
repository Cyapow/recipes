// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Meals } from './Meals';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  listMeals: vi.fn(), listRecipes: vi.fn(), createMeal: vi.fn(),
}));
import { ApiError, createMeal, listMeals, listRecipes } from '../api';

const recipe = (id: string, title: string) => ({ id, title, origin: 'mine', sourceName: null, tags: [], thumbnailId: null, totalMinutes: null }) as never;
const view = () =>
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<Meals />} />
        <Route path="/meals/:id" element={<p>The meal page</p>} />
      </Routes>
    </MemoryRouter>,
  );
const fill = async () => {
  await userEvent.type(await screen.findByLabelText('Name'), 'Sunday lunch');
  fireEvent.change(screen.getByLabelText('When do you want to eat?'), { target: { value: '2026-12-06T13:30' } });
};
const button = () => screen.getByRole('button', { name: 'Create meal' }) as HTMLButtonElement;

beforeEach(() => {
  vi.mocked(listMeals).mockReset().mockResolvedValue([]);
  vi.mocked(listRecipes).mockReset().mockResolvedValue([recipe('r1', 'Roast chicken'), recipe('r2', 'Gravy')]);
  vi.mocked(createMeal).mockReset().mockResolvedValue({ id: 'm1' } as never);
});
afterEach(cleanup);

describe('Meals', () => {
  it('lists meals with their serving time and what they hold', async () => {
    vi.mocked(listMeals).mockResolvedValue([
      { id: 'm1', title: 'Christmas dinner', serveAt: '2026-12-25T13:00:00.000Z', recipeCount: 4, stageCount: 10, doneCount: 3 },
    ]);
    view();
    const link = await screen.findByRole('link', { name: /Christmas dinner/ });
    expect(link.getAttribute('href')).toBe('/meals/m1');
    expect(link.textContent).toContain('4 recipes');
    expect(link.textContent).toContain('3 of 10 steps done');
    expect(link.textContent).toContain('Dec');
  });

  it('will not create a meal with no recipes', async () => {
    view();
    await fill();
    await screen.findByLabelText('Roast chicken');
    expect(button().disabled).toBe(true);
    await userEvent.click(screen.getByLabelText('Roast chicken'));
    await waitFor(() => expect(button().disabled).toBe(false));
  });

  it('creates a meal from the picked recipes with their courses and serving time', async () => {
    view();
    await fill();
    await userEvent.click(await screen.findByLabelText('Roast chicken'));
    await userEvent.click(button());
    await screen.findByText('The meal page');
    expect(vi.mocked(createMeal)).toHaveBeenCalledWith({ title: 'Sunday lunch', serveAt: expect.any(String), recipes: [{ recipeId: 'r1', course: 'main' }] });
    expect(vi.mocked(createMeal).mock.calls[0][0].serveAt).toBe(new Date(2026, 11, 6, 13, 30).toISOString());
  });

  it('sends the course chosen for a recipe', async () => {
    view();
    await fill();
    await userEvent.click(await screen.findByLabelText('Gravy'));
    await userEvent.selectOptions(await screen.findByLabelText('Course for Gravy'), 'side');
    await userEvent.click(button());
    await screen.findByText('The meal page');
    expect(vi.mocked(createMeal).mock.calls[0][0].recipes).toEqual([{ recipeId: 'r2', course: 'side' }]);
  });

  it('shows an error when the meal could not be created', async () => {
    vi.mocked(createMeal).mockRejectedValue(new ApiError('Request failed (400)', 400, { error: 'That recipe was picked twice' }));
    view();
    await fill();
    await userEvent.click(await screen.findByLabelText('Roast chicken'));
    await userEvent.click(button());
    expect((await screen.findByRole('alert')).textContent).toBe('That recipe was picked twice');
    expect(screen.queryByText('The meal page')).toBeNull();
    await waitFor(() => expect(button().disabled).toBe(false));
  });
});
