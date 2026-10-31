// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PrintCard } from './PrintCard';
import type { Recipe } from '../api';

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, getRecipe: vi.fn() };
});
import { getRecipe } from '../api';

const base: Recipe = {
  id: 'a', title: 'Spag bol', description: 'Better the next day.', origin: 'mine', sourceName: null, sourceUrl: null,
  servings: 4, prepMinutes: 10, cookMinutes: 40,
  ingredients: [
    { group: null, quantity: 500, unit: 'g', item: 'beef mince', note: null },
    { group: 'To serve', quantity: 400, unit: 'g', item: 'spaghetti', note: null },
  ],
  steps: [
    { text: 'Brown the mince.', imageId: null, ingredients: [0] },
    { text: 'Boil the spaghetti.', imageId: null, ingredients: [1] },
  ],
  notes: 'Freezes well.', tags: [], imageIds: [], createdAt: '', updatedAt: 'v1',
};

const show = (r: Partial<Recipe> = {}) => {
  vi.mocked(getRecipe).mockResolvedValue({ ...base, ...r });
  return render(
    <MemoryRouter initialEntries={['/recipe/a/print']}>
      <Routes>
        <Route path="/recipe/:id/print" element={<PrintCard />} />
      </Routes>
    </MemoryRouter>,
  );
};

// A block body, not a one-liner: a returned mock would be taken for a teardown callback and called after the test.
beforeEach(() => {
  vi.mocked(getRecipe).mockReset();
});
afterEach(cleanup);

describe('the printable card', () => {
  it('lists every ingredient once and every step in order', async () => {
    show();
    const method = await screen.findByRole('list', { name: 'Method' });
    expect(within(method).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1Brown the mince.',
      '2Boil the spaghetti.',
    ]);
    const ingredients = screen.getByRole('list', { name: 'Ingredients' });
    expect(within(ingredients).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '500gbeef mince',
      'To serve',
      '400gspaghetti',
    ]);
  });

  it('carries the notes and the serving details', async () => {
    show();
    expect(await screen.findByText('Freezes well.')).toBeTruthy();
    expect(screen.getAllByText(/4 servings · Prep 10m · Cook 40m/).length).toBeGreaterThan(0);
  });

  it('shows a QR code pointing at this recipe', async () => {
    show();
    const qr = await screen.findByRole('img', { name: 'Scan to open http://localhost:3000/recipe/a' });
    expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M/);
  });

  it('gives the photo its own page when the recipe has one', async () => {
    show({ imageIds: ['img1'] });
    const page = await screen.findByTestId('photo-page');
    expect(within(page).getByRole('img', { name: 'Spag bol' })).toHaveProperty(
      'src',
      expect.stringContaining('/api/images/img1'),
    );
  });

  it('prints one side when there is no photo', async () => {
    show();
    await screen.findByRole('list', { name: 'Method' });
    expect(screen.queryByTestId('photo-page')).toBeNull();
  });

  it('credits the site an imported recipe came from', async () => {
    show({ origin: 'other', sourceName: 'slowcookerclub.com', sourceUrl: 'https://www.slowcookerclub.com/chilli/' });
    expect(await screen.findByText('From slowcookerclub.com')).toBeTruthy();
  });

  it('opens the print dialog when you ask it to', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('says so when the recipe cannot be loaded', async () => {
    vi.mocked(getRecipe).mockRejectedValue(new Error('nope'));
    render(
      <MemoryRouter initialEntries={['/recipe/a/print']}>
        <Routes>
          <Route path="/recipe/:id/print" element={<PrintCard />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('Could not load recipe');
    expect(screen.getByRole('link', { name: 'Back to library' }).getAttribute('href')).toBe('/');
  });
});
