// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Library } from './Library';
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
  vi.mocked(listRecipes).mockReset().mockResolvedValue([
    { ...summary, id: 'a', title: 'Carbonara', favouritedBy: ['me@x.com', 'you@x.com'] },
    { ...summary, id: 'b', title: 'Dal', favouritedBy: ['you@x.com'] },
  ]);
  vi.mocked(getFacets).mockReset().mockResolvedValue({ brands: [], tags: [] });
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
