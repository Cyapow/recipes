// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Library, LIBRARY_FILTERS_KEY } from './Library';
import { loadFilters } from '../components/RecipeBrowser';
import { MeProvider } from '../lib/me';

vi.mock('../api', () => ({
  listRecipes: vi.fn(),
  getFacets: vi.fn(),
  getBackupStatus: vi.fn(),
  setFavourite: vi.fn(),
}));
import { getBackupStatus, getFacets, listRecipes, setFavourite } from '../api';

const summary = { origin: 'mine' as const, brand: 'Mine', sourceName: null, tags: [], thumbnailId: null, totalMinutes: 30 };
const heart = (title: string, pressed: boolean) => screen.getByRole('button', { name: `Favourite ${title}`, pressed });

const renderLibrary = () => render(<MeProvider me={{ email: 'me@x.com', name: 'Me' }}><MemoryRouter><Library /></MemoryRouter></MeProvider>);

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(listRecipes).mockReset().mockResolvedValue([
    { ...summary, id: 'a', title: 'Carbonara', favouritedBy: ['me@x.com', 'you@x.com'] },
    { ...summary, id: 'b', title: 'Dal', favouritedBy: ['you@x.com'] },
  ]);
  vi.mocked(getFacets).mockReset().mockResolvedValue({ brands: [], tags: [], people: [{ email: 'me@x.com', name: 'Me', count: 1 }, { email: 'you@x.com', name: 'You', count: 2 }] });
  vi.mocked(getBackupStatus).mockReset().mockResolvedValue({
    configured: true, connected: true, account: 'a@b.c', banner: 'none', lastRunAt: null, lastSuccessAt: null, lastError: null, lastUploadAt: null, running: false,
  });
  vi.mocked(setFavourite).mockReset().mockResolvedValue();
});
afterEach(cleanup);

describe('Library hearts', () => {
  it('shows a filled heart on a recipe you have starred', async () => {
    renderLibrary();
    await screen.findByText('Carbonara');
    expect(heart('Carbonara', true)).toBeTruthy();
  });

  it('shows an empty heart on one you have not, even if someone else has', async () => {
    renderLibrary();
    await screen.findByText('Dal');
    expect(heart('Dal', false)).toBeTruthy();
  });

  it('starring updates the heart without reloading the list or reordering it', async () => {
    renderLibrary();
    await screen.findByText('Dal');
    await userEvent.click(heart('Dal', false));
    expect(heart('Dal', true)).toBeTruthy();
    expect(setFavourite).toHaveBeenCalledWith('b', true);
    expect(listRecipes).toHaveBeenCalledTimes(1);
    const titles = screen.getAllByRole('link', { name: /Carbonara|Dal/ }).map((l) => l.textContent);
    expect(titles[0]).toMatch(/Carbonara/);
    expect(titles[1]).toMatch(/Dal/);
  });

  it('unstarring empties the heart', async () => {
    renderLibrary();
    await screen.findByText('Carbonara');
    await userEvent.click(heart('Carbonara', true));
    expect(heart('Carbonara', false)).toBeTruthy();
    expect(setFavourite).toHaveBeenCalledWith('a', false);
  });

  it('a failed star puts the heart back', async () => {
    let fail!: (e: Error) => void;
    vi.mocked(setFavourite).mockReturnValue(new Promise<void>((_, reject) => { fail = reject; }));
    renderLibrary();
    await screen.findByText('Dal');
    await userEvent.click(heart('Dal', false));
    expect(heart('Dal', true)).toBeTruthy();
    fail(new Error('offline'));
    await waitFor(() => expect(heart('Dal', false)).toBeTruthy());
    expect(heart('Carbonara', true)).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't save that favourite/);
  });

  it('keeps the heart outside the recipe link, so tapping it does not open the recipe', async () => {
    renderLibrary();
    await screen.findByText('Dal');
    expect(screen.getByRole('button', { name: 'Favourite Dal' }).closest('a')).toBeNull();
  });
});

describe('Library favourites filter', () => {
  const rows = [
    { ...summary, id: 'a', title: 'Carbonara', favouritedBy: ['me@x.com'] },
    { ...summary, id: 'b', title: 'Dal', favouritedBy: ['you@x.com'] },
    { ...summary, id: 'c', title: 'Eggs', favouritedBy: [] as string[] },
  ];
  beforeEach(() => {
    vi.mocked(listRecipes).mockImplementation(async (q) =>
      rows.filter((r) => !q?.favouritedBy || q.favouritedBy.some((e) => r.favouritedBy.includes(e))));
  });
  const openSheet = async () => {
    await screen.findByText('Carbonara');
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
  };
  const titles = () => screen.getAllByRole('link', { name: /Carbonara|Dal|Eggs/ }).map((l) => l.textContent);

  it('ticking a person filters the list to their favourites', async () => {
    renderLibrary();
    await openSheet();
    await userEvent.click(screen.getByRole('button', { name: 'You · 2' }));
    await waitFor(() => expect(titles()).toEqual([expect.stringMatching(/Dal/)]));
  });

  it('ticking two people shows either persons favourites', async () => {
    renderLibrary();
    await openSheet();
    await userEvent.click(screen.getByRole('button', { name: 'You · 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Me · 1' }));
    await waitFor(() => expect(titles()).toHaveLength(2));
    expect(titles().join()).not.toMatch(/Eggs/);
  });

  it('counts the person in the Filters button, shows a chip, and the chip removes them', async () => {
    renderLibrary();
    await openSheet();
    await userEvent.click(screen.getByRole('button', { name: 'You · 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show 1 recipe' }));
    expect(screen.getByRole('button', { name: 'Filters · 1' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter You' }));
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    await waitFor(() => expect(titles()).toHaveLength(3));
  });

  it('a stored filter from before this feature loads without crashing', () => {
    sessionStorage.setItem('recipes.libraryFilters', JSON.stringify({ brands: [], tags: [] }));
    expect(loadFilters(LIBRARY_FILTERS_KEY).people).toEqual([]);
  });

  it('keeps only addresses from a stored filter', () => {
    sessionStorage.setItem('recipes.libraryFilters', JSON.stringify({ brands: [], tags: [], people: ['a@x.com', 3] }));
    expect(loadFilters(LIBRARY_FILTERS_KEY).people).toEqual(['a@x.com']);
  });
});
