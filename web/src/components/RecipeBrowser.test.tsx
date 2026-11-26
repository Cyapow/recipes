// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeBrowser, loadFilters } from './RecipeBrowser';
import type { RecipeSummary } from '../api';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  listRecipes: vi.fn(),
  getFacets: vi.fn(),
}));
import { getFacets, listRecipes } from '../api';

const recipe = (id: string, title: string): RecipeSummary => ({
  id, title, origin: 'mine', brand: null, sourceName: null, tags: [], thumbnailId: null, totalMinutes: null, favouritedBy: [],
});

/** The row is the caller's: here it prints the title and who has starred it, and offers a way to patch itself. */
const row = (r: RecipeSummary, patch: (next: Partial<RecipeSummary>) => void) => (
  <li key={r.id}>
    <span>{r.title}{r.favouritedBy.length > 0 ? ` ★${r.favouritedBy.join(',')}` : ''}</span>
    <button type="button" onClick={() => patch({ favouritedBy: ['a@x.com'] })}>Star {r.title}</button>
  </li>
);

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(listRecipes).mockReset().mockResolvedValue([recipe('r1', 'Roast chicken'), recipe('r2', 'Gravy')]);
  vi.mocked(getFacets).mockReset().mockResolvedValue({
    brands: [{ name: 'Hairy Bikers', count: 2 }],
    tags: [{ group: 'meal', name: 'Dinner', count: 3 }],
    people: [{ email: 'a@x.com', name: 'Ada', count: 1 }],
  });
});
afterEach(cleanup);

describe('RecipeBrowser', () => {
  it('asks the server for the search text and the active filters', async () => {
    render(<RecipeBrowser renderRow={row} />);
    await screen.findByText('Roast chicken');

    await userEvent.type(screen.getByLabelText('Search recipes'), 'mince');
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hairy Bikers' }));

    await waitFor(() =>
      expect(vi.mocked(listRecipes).mock.calls.at(-1)?.[0]).toEqual({ search: 'mince', brands: ['Hairy Bikers'] }));
  });

  it('removes a filter from the bar when its chip is clicked', async () => {
    render(<RecipeBrowser renderRow={row} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hairy Bikers' }));
    await userEvent.click(screen.getByTestId('filter-backdrop'));

    await userEvent.click(await screen.findByRole('button', { name: 'Remove filter Hairy Bikers' }));

    await waitFor(() => expect(vi.mocked(listRecipes).mock.calls.at(-1)?.[0]).toEqual({}));
  });

  it('keeps filters under its storage key and reads them back', async () => {
    const { unmount } = render(<RecipeBrowser renderRow={row} storageKey="k" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hairy Bikers' }));
    await waitFor(() => expect(loadFilters('k').brands).toEqual(['Hairy Bikers']));

    unmount();
    render(<RecipeBrowser renderRow={row} storageKey="k" />);
    expect(await screen.findByRole('button', { name: 'Filters · 1' })).toBeTruthy();
  });

  it('keeps its filters to itself when it has no storage key', async () => {
    render(<RecipeBrowser renderRow={row} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hairy Bikers' }));
    await screen.findByRole('button', { name: 'Remove filter Hairy Bikers' });

    expect(sessionStorage.length).toBe(0);
  });

  it('ignores filters saved in a shape it does not understand', () => {
    sessionStorage.setItem('k', '{"brands":"nope","tags":[{"group":1}],"people":null}');
    expect(loadFilters('k')).toEqual({ brands: [], tags: [], people: [] });
  });

  it('patches one row without asking the server again', async () => {
    render(<RecipeBrowser renderRow={row} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Star Gravy' }));

    expect(await screen.findByText('Gravy ★a@x.com')).toBeTruthy();
    expect(screen.getByText('Roast chicken')).toBeTruthy();
    expect(vi.mocked(listRecipes)).toHaveBeenCalledTimes(1);
  });

  it('tells the two empty lists apart', async () => {
    vi.mocked(listRecipes).mockResolvedValue([]);
    render(<RecipeBrowser renderRow={row} />);
    expect(await screen.findByText('No recipes yet.')).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Search recipes'), 'z');
    expect(await screen.findByText('No recipes match that.')).toBeTruthy();
  });

  it('says so when the recipes could not be loaded', async () => {
    vi.mocked(listRecipes).mockRejectedValue(new Error('nope'));
    render(<RecipeBrowser renderRow={row} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not load recipes');
  });

  it('renders no button that would submit a form it sits in', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={onSubmit}><RecipeBrowser renderRow={row} /></form>);

    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hairy Bikers' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('hands the results to the caller that wants to remember them', async () => {
    const onResults = vi.fn();
    render(<RecipeBrowser renderRow={row} onResults={onResults} />);
    await waitFor(() => expect(onResults.mock.calls.at(-1)?.[0].map((r: RecipeSummary) => r.id)).toEqual(['r1', 'r2']));
  });

  it('puts the caller\'s own block between the search box and the filters', async () => {
    const { container } = render(<RecipeBrowser renderRow={row} afterSearch={<p>Describe it</p>} />);
    await screen.findByText('Roast chicken');

    const order = [...container.querySelectorAll('.search-field, p, .filter-bar')].map((e) =>
      e.classList.contains('search-field') ? 'search' : e.classList.contains('filter-bar') ? 'filters' : 'caller');
    expect(order).toEqual(['search', 'caller', 'filters']);
  });

  it('renders what the caller puts above the results', async () => {
    render(<RecipeBrowser renderRow={row} beforeList={<p>Already picked</p>} />);
    expect(await screen.findByText('Already picked')).toBeTruthy();
  });
});
