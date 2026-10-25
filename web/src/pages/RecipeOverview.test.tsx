// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { RecipeOverview } from './RecipeOverview';
import type { Recipe } from '../api';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, getRecipe: vi.fn(), addToShopping: vi.fn() };
});
import { addToShopping, ApiError, getRecipe } from '../api';

vi.mock('./Cook', () => ({ Cook: () => <p>COOK PAGE</p> }));
import { App } from '../App';

const base: Recipe = {
  id: 'a', title: 'Carbonara', description: '', origin: 'mine', sourceName: null, sourceUrl: null,
  servings: 2, prepMinutes: 5, cookMinutes: 70,
  ingredients: [
    { group: null, quantity: 200, unit: 'g', item: 'spaghetti', note: null },
    { group: null, quantity: 3, unit: null, item: 'eggs', note: 'large' },
    { group: null, quantity: null, unit: null, item: 'black pepper', note: null },
  ],
  steps: [], notes: '', tags: [], imageIds: [], createdAt: '', updatedAt: '',
};
const other: Recipe = { ...base, id: 'b', title: 'Soup', ingredients: [{ group: null, quantity: 1, unit: null, item: 'leek', note: null }] };

function renderAt(path = '/recipe/a') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Link to="/recipe/b">to-b</Link>
      <Routes>
        <Route path="/" element={<p>LIBRARY</p>} />
        <Route path="/recipe/:id" element={<RecipeOverview />} />
      </Routes>
    </MemoryRouter>,
  );
}
const box = (name: string) => screen.findByRole('checkbox', { name: `We have this: ${name}` });

beforeEach(() => {
  vi.mocked(getRecipe).mockReset().mockImplementation(async (id) => (id === 'b' ? other : base));
  vi.mocked(addToShopping).mockReset().mockResolvedValue({ added: 2 });
});
afterEach(cleanup);

describe('RecipeOverview', () => {
  it('shows header, title, meta, hero and links', async () => {
    vi.mocked(getRecipe).mockResolvedValue({ ...base, imageIds: ['h.jpg'] });
    renderAt();
    await screen.findByRole('heading', { name: 'Carbonara' });
    expect(screen.getByText('Mine')).toBeTruthy();
    expect(screen.getByText(/2 servings/)).toBeTruthy();
    expect(screen.getByText(/1h 10m/)).toBeTruthy();
    expect((screen.getByAltText('Carbonara') as HTMLImageElement).getAttribute('src')).toBe('/api/images/h.jpg');
    expect(screen.getByRole('link', { name: 'Back to library' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe('/recipe/a/edit');
    expect(screen.getByRole('link', { name: 'Shopping list' }).getAttribute('href')).toBe('/shopping');
    expect(screen.getByRole('link', { name: 'Start cooking' }).getAttribute('href')).toBe('/recipe/a/cook');
    expect(screen.getByText('0 of 3 ticked')).toBeTruthy();
  });

  it('sends only the unticked indexes', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(await box('3 eggs (large)'));
    expect(screen.getByText('1 of 3 ticked')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add 2 to shopping list' }));
    expect(addToShopping).toHaveBeenCalledWith('a', [0, 2], undefined);
  });

  it('sends all indexes when nothing is ticked', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole('button', { name: 'Add 3 to shopping list' }));
    expect(addToShopping).toHaveBeenCalledWith('a', [0, 1, 2], undefined);
  });

  it('with everything ticked says Nothing to add and sends nothing', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole('button', { name: 'Tick all' }));
    expect((await screen.findByRole('button', { name: 'Untick all' }))).toBeTruthy();
    expect(screen.getByText('3 of 3 ticked')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Nothing to add' }));
    expect(addToShopping).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Untick all' }));
    expect(screen.getByText('0 of 3 ticked')).toBeTruthy();
    expect(screen.getAllByText('Need')).toHaveLength(3);
  });

  it('marks ticked rows Have it', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(await box('200 g spaghetti'));
    expect(screen.getAllByText('Have it')).toHaveLength(1);
  });

  it('ignores a second click while the request is in flight', async () => {
    const user = userEvent.setup();
    let resolve!: (v: { added: number }) => void;
    vi.mocked(addToShopping).mockReturnValue(new Promise((r) => { resolve = r; }));
    renderAt();
    const btn = await screen.findByRole('button', { name: 'Add 3 to shopping list' });
    await user.dblClick(btn);
    expect(addToShopping).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeTruthy();
    resolve({ added: 3 });
    await screen.findByText('Added 3 items to your shopping list');
  });

  it('shows success status with a link to the list', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(await screen.findByRole('button', { name: 'Add 3 to shopping list' }));
    await screen.findByText('Added 2 items to your shopping list');
    expect(screen.getByRole('link', { name: 'View shopping list' }).getAttribute('href')).toBe('/shopping');
  });

  it('409 offers Add again (force) and Cancel (no request)', async () => {
    const user = userEvent.setup();
    vi.mocked(addToShopping).mockRejectedValueOnce(new ApiError('x', 409, { error: 'already_on_list', recipeTitle: 'Carbonara' }));
    renderAt();
    await user.click(await screen.findByRole('button', { name: 'Add 3 to shopping list' }));
    await screen.findByText('Carbonara is already on your shopping list.');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/already on your shopping list/)).toBeNull();
    expect(addToShopping).toHaveBeenCalledTimes(1);

    vi.mocked(addToShopping).mockRejectedValueOnce(new ApiError('x', 409, { error: 'already_on_list', recipeTitle: 'Carbonara' }));
    await user.click(screen.getByRole('button', { name: 'Add 3 to shopping list' }));
    await user.click(await screen.findByRole('button', { name: 'Add again' }));
    expect(addToShopping).toHaveBeenLastCalledWith('a', [0, 1, 2], true);
    await screen.findByText('Added 2 items to your shopping list');
  });

  it('shows an error and lets the button work again after a failure', async () => {
    const user = userEvent.setup();
    vi.mocked(addToShopping).mockRejectedValueOnce(new Error('boom'));
    renderAt();
    await user.click(await screen.findByRole('button', { name: 'Add 3 to shopping list' }));
    await screen.findByText('Could not add to the shopping list');
    await user.click(screen.getByRole('button', { name: 'Add 3 to shopping list' }));
    expect(addToShopping).toHaveBeenCalledTimes(2);
    await screen.findByText('Added 2 items to your shopping list');
    expect(screen.queryByText('Could not add to the shopping list')).toBeNull();
  });

  it('shows not found with a link back, and a generic load error', async () => {
    vi.mocked(getRecipe).mockRejectedValue(new ApiError('Request failed (404)', 404));
    const { unmount } = renderAt();
    await screen.findByText('Recipe not found');
    expect(screen.getByRole('link', { name: 'Back to library' }).getAttribute('href')).toBe('/');
    unmount();
    vi.mocked(getRecipe).mockRejectedValue(new Error('net'));
    renderAt();
    await screen.findByText('Could not load recipe');
  });

  it('resets ticks when navigating to another recipe', async () => {
    const user = userEvent.setup();
    renderAt();
    await user.click(await box('200 g spaghetti'));
    await user.click(screen.getByRole('link', { name: 'to-b' }));
    await screen.findByRole('heading', { name: 'Soup' });
    expect(screen.getByText('0 of 1 ticked')).toBeTruthy();
    expect((await box('1 leek') as HTMLInputElement).checked).toBe(false);
  });

  it('shows a message instead of the checklist when there are no ingredients', async () => {
    vi.mocked(getRecipe).mockResolvedValue({ ...base, ingredients: [] });
    renderAt();
    await screen.findByRole('heading', { name: 'Carbonara' });
    expect(screen.queryByText('What do we already have?')).toBeNull();
    expect(screen.getByText('No ingredients listed.')).toBeTruthy();
  });
});

describe('routes', () => {
  it('/recipe/:id is the overview and /recipe/:id/cook is Cook', async () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/recipe/a']}><App /></MemoryRouter>);
    await screen.findByText('What do we already have?');
    unmount();
    render(<MemoryRouter initialEntries={['/recipe/a/cook']}><App /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('COOK PAGE')).toBeTruthy());
  });
});
