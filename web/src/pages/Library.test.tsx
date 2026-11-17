// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Library } from './Library';

vi.mock('../api', () => ({
  listRecipes: vi.fn(),
  getFacets: vi.fn(),
  getBackupStatus: vi.fn(),
}));
import { getBackupStatus, listRecipes, getFacets } from '../api';

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(listRecipes).mockReset().mockResolvedValue([
    { id: 'a', title: 'Carbonara', origin: 'mine', brand: 'Mine', sourceName: null, tags: [{ group: 'other', name: 'Pasta' }], thumbnailId: null, totalMinutes: 90 },
    { id: 'b', title: 'Dal', origin: 'other', brand: null, sourceName: 'BBC', tags: [], thumbnailId: 'img1', totalMinutes: 45 },
  ]);
  vi.mocked(getFacets).mockReset().mockResolvedValue({ brands: [], tags: [{ group: 'other', name: 'Pasta', count: 1 }] });
  vi.mocked(getBackupStatus).mockReset().mockResolvedValue({
    configured: true, connected: true, account: 'a@b.c', banner: 'none', lastRunAt: null, lastSuccessAt: null, lastError: null, lastUploadAt: null, running: false,
  });
});

describe('Library backup banner', () => {
  it('shows the banner for a non-none state, with a Settings link', async () => {
    vi.mocked(getBackupStatus).mockResolvedValue({
      configured: true, connected: false, account: null, banner: 'not_connected', lastRunAt: null, lastSuccessAt: null, lastError: null, lastUploadAt: null, running: false,
    });
    render(<MemoryRouter><Library /></MemoryRouter>);
    expect(await screen.findByText(/Not backed up yet/)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Settings' }).length).toBeGreaterThan(0);
  });
  it('shows nothing for none', async () => {
    render(<MemoryRouter><Library /></MemoryRouter>);
    await screen.findByText('Carbonara');
    expect(screen.queryByText(/Not backed up|No successful backup|Last backup failed|check backup/)).toBeNull();
  });
  it('says so when the status cannot be loaded', async () => {
    vi.mocked(getBackupStatus).mockRejectedValue(new Error('x'));
    render(<MemoryRouter><Library /></MemoryRouter>);
    expect(await screen.findByText("Couldn't check backup status")).toBeTruthy();
  });
});

describe('Library', () => {
  it('renders rows with subtitles', async () => {
    render(<MemoryRouter><Library /></MemoryRouter>);
    expect(await screen.findByText('Carbonara')).toBeTruthy();
    expect(screen.getByText('Mine · Pasta · 1h 30m')).toBeTruthy();
    expect(screen.getByText('From elsewhere · 45m')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Carbonara/ }).getAttribute('href')).toBe('/recipe/a');
  });

  it('has no Mine / From elsewhere segmented control', async () => {
    render(<MemoryRouter><Library /></MemoryRouter>);
    await screen.findByText('Carbonara');
    expect(screen.queryByRole('button', { name: 'From elsewhere' })).toBeNull();
  });
});

describe('Library filters', () => {
  beforeEach(() => {
    try { sessionStorage.clear(); } catch { /* ignore */ }
    vi.mocked(getFacets).mockResolvedValue({
      brands: [{ name: 'Gousto', count: 2 }],
      tags: [{ group: 'cuisine', name: 'Thai', count: 1 }],
    });
  });
  async function apply(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText('Carbonara');
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.click(await screen.findByRole('button', { name: 'Gousto' }));
    await user.click(screen.getByRole('button', { name: 'Thai' }));
  }
  it('queries with chosen brand and tag, shows Filters · 2 and the result count', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><Library /></MemoryRouter>);
    await apply(user);
    await waitFor(() =>
      expect(vi.mocked(listRecipes)).toHaveBeenLastCalledWith({
        search: undefined, brands: ['Gousto'], tags: [{ group: 'cuisine', name: 'Thai' }],
      }),
    );
    expect(screen.getByRole('button', { name: 'Show 2 recipes' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show 2 recipes' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Filters · 2' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Filters · 2' }));
  });
  it('removes one filter via its pill', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><Library /></MemoryRouter>);
    await apply(user);
    await user.click(screen.getByRole('button', { name: 'Show 2 recipes' }));
    await user.click(screen.getByRole('button', { name: 'Remove filter Gousto' }));
    await waitFor(() =>
      expect(vi.mocked(listRecipes)).toHaveBeenLastCalledWith({
        search: undefined, brands: undefined, tags: [{ group: 'cuisine', name: 'Thai' }],
      }),
    );
    expect(screen.getByRole('button', { name: 'Filters · 1' })).toBeTruthy();
  });
  it('Clear all empties the filters', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><Library /></MemoryRouter>);
    await apply(user);
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() =>
      expect(vi.mocked(listRecipes)).toHaveBeenLastCalledWith({ search: undefined, brands: undefined, tags: undefined }),
    );
    await user.click(screen.getByRole('button', { name: 'Show 2 recipes' }));
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
  });
  it('starts empty when stored filters are corrupt JSON', async () => {
    sessionStorage.setItem('recipes.libraryFilters', '{not json');
    render(<MemoryRouter><Library /></MemoryRouter>);
    await screen.findByText('Carbonara');
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
  });
  it('starts empty and does not crash when sessionStorage throws', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    try {
      render(<MemoryRouter><Library /></MemoryRouter>);
      await screen.findByText('Carbonara');
      expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
  it('keeps filters across unmount and remount', async () => {
    const user = userEvent.setup();
    const first = render(<MemoryRouter><Library /></MemoryRouter>);
    await apply(user);
    first.unmount();
    render(<MemoryRouter><Library /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Filters · 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove filter Thai' })).toBeTruthy();
  });
});

describe('Library redesign', () => {
  it('has the CTA and icon links', async () => {
    render(<MemoryRouter><Library /></MemoryRouter>);
    await screen.findByText('Carbonara');
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(href('Describe it')).toBe('/describe');
    expect(href('From a link')).toBe('/import');
    expect(href('From photos')).toBe('/photos');
    expect(href('New recipe')).toBe('/new');
    expect(href('Settings')).toBe('/settings');
    expect(href('Shopping list')).toBe('/shopping');
  });
  it('shows a monogram tile without a thumbnail and an image with one', async () => {
    render(<MemoryRouter><Library /></MemoryRouter>);
    await screen.findByText('Carbonara');
    const tile = screen.getByText('CA');
    expect(tile.getAttribute('aria-hidden')).toBe('true');
    expect(tile.getAttribute('style')).toContain('var(--tile-');
    const img = screen.getByRole('link', { name: /Dal/ }).querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/images/img1/thumb');
    expect(screen.queryByText('DA')).toBeNull();
  });
});
