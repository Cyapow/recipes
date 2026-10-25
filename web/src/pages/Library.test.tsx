// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Library } from './Library';

vi.mock('../api', () => ({
  listRecipes: vi.fn(),
  listTags: vi.fn(),
  getBackupStatus: vi.fn(),
}));
import { getBackupStatus, listRecipes, listTags } from '../api';

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(listRecipes).mockReset().mockResolvedValue([
    { id: 'a', title: 'Carbonara', origin: 'mine', sourceName: null, tags: ['Pasta'], thumbnailId: null, totalMinutes: 90 },
    { id: 'b', title: 'Dal', origin: 'other', sourceName: 'BBC', tags: [], thumbnailId: 'img1', totalMinutes: 45 },
  ]);
  vi.mocked(listTags).mockReset().mockResolvedValue(['Pasta']);
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
    expect(screen.getByText('BBC · 45m')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Carbonara/ }).getAttribute('href')).toBe('/recipe/a');
  });

  it('re-queries with origin mine when Mine clicked', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><Library /></MemoryRouter>);
    await screen.findByText('Carbonara');
    await user.click(screen.getByRole('button', { name: 'Mine' }));
    await waitFor(() =>
      expect(vi.mocked(listRecipes)).toHaveBeenLastCalledWith(expect.objectContaining({ origin: 'mine' })),
    );
  });
});

describe('Library redesign', () => {
  it('has the CTA and icon links', async () => {
    render(<MemoryRouter><Library /></MemoryRouter>);
    await screen.findByText('Carbonara');
    const href = (name: string) => screen.getByRole('link', { name }).getAttribute('href');
    expect(href('Describe it')).toBe('/describe');
    expect(href('From a link')).toBe('/import');
    expect(href('New recipe')).toBe('/new');
    expect(href('Settings')).toBe('/settings');
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
