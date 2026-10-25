// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Cook } from './Cook';
import type { Recipe } from '../api';

vi.mock('../api', () => ({ getRecipe: vi.fn() }));
import { getRecipe } from '../api';

const base: Recipe = {
  id: 'a', title: 'Carbonara', description: 'Classic.', origin: 'mine', sourceName: null, sourceUrl: null,
  servings: 2, prepMinutes: 5, cookMinutes: 10,
  ingredients: [
    { group: 'Pasta', quantity: 200, unit: 'g', item: 'spaghetti', note: null },
    { group: 'Sauce', quantity: 0.3333333333333333, unit: 'cup', item: 'pecorino', note: 'grated' },
    { group: 'Sauce', quantity: null, unit: null, item: 'black pepper', note: null },
  ],
  steps: [{ text: 'Boil pasta.', imageId: null, ingredients: [] }, { text: 'Mix eggs.', imageId: null, ingredients: [] }, { text: 'Combine.', imageId: null, ingredients: [] }],
  notes: 'Use guanciale.', tags: ['Pasta'], imageIds: [], createdAt: '', updatedAt: '',
};

function renderCook() {
  return render(
    <MemoryRouter initialEntries={['/recipe/a/cook']}>
      <Routes>
        <Route path="/" element={<p>LIBRARY</p>} />
        <Route path="/recipe/:id/cook" element={<Cook />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getRecipe).mockReset().mockResolvedValue(base);
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request: vi.fn(async () => Object.assign(new EventTarget(), { release: vi.fn(async () => {}), released: false })) },
  });
});
afterEach(() => {
  cleanup();
  delete (navigator as unknown as Record<string, unknown>).wakeLock;
});

describe('Cook', () => {
  it('shows the first image as a hero with the title as alt, none when no images', async () => {
    vi.mocked(getRecipe).mockResolvedValue({ ...base, imageIds: ['h1.jpg', 'h2.jpg'] });
    const { unmount } = renderCook();
    const img = (await screen.findByAltText('Carbonara')) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/images/h1.jpg');
    unmount();
    vi.mocked(getRecipe).mockResolvedValue({ ...base, imageIds: [] });
    renderCook();
    await screen.findByRole('heading', { name: 'Carbonara' });
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders header, ingredients and first step', async () => {
    renderCook();
    expect(await screen.findByRole('heading', { name: 'Carbonara' })).toBeTruthy();
    expect(screen.getByText('Mine · Pasta')).toBeTruthy();
    expect(screen.getByRole('link', { name: /back/i }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe('/recipe/a/edit');
    expect(screen.getByText('Sauce')).toBeTruthy();
    expect(screen.getByText(/200 g spaghetti/)).toBeTruthy();
    expect(screen.getByText(/0\.33 cup pecorino/)).toBeTruthy();
    expect(screen.queryByText(/0\.3333/)).toBeNull();
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(screen.getByText('Boil pasta.')).toBeTruthy();
  });

  it('steps forward and back and finishes with Done', async () => {
    const user = userEvent.setup();
    renderCook();
    await screen.findByText('Boil pasta.');
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByText('Combine.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('LIBRARY')).toBeTruthy();
  });

  it('shows the Keep screen on toggle and wires it to wake lock', async () => {
    const user = userEvent.setup();
    renderCook();
    const toggle = (await screen.findByRole('checkbox', { name: 'Keep screen on' })) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    await user.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(navigator.wakeLock.request).toHaveBeenCalledTimes(1);
  });

  it('shows a note instead of the toggle when unsupported', async () => {
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
    renderCook();
    await screen.findByText('Carbonara');
    expect(screen.getByText("Your browser can't keep the screen on")).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Keep screen on' })).toBeNull();
  });

  it('shows notes when there are no steps', async () => {
    vi.mocked(getRecipe).mockResolvedValue({ ...base, steps: [] });
    renderCook();
    await screen.findByText('Carbonara');
    expect(screen.getByText('Use guanciale.')).toBeTruthy();
    expect(screen.queryByText(/Step 1/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
  });

  it('shows not-found with a link to the library', async () => {
    vi.mocked(getRecipe).mockRejectedValue(new Error('Request failed (404)'));
    renderCook();
    expect(await screen.findByText('Recipe not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: /library/i }).getAttribute('href')).toBe('/');
  });

  it('shows an error with a link to the library on load failure', async () => {
    vi.mocked(getRecipe).mockRejectedValue(new Error('Request failed (500)'));
    renderCook();
    expect(await screen.findByText('Could not load recipe')).toBeTruthy();
    expect(screen.getByRole('link', { name: /library/i }).getAttribute('href')).toBe('/');
  });
});
