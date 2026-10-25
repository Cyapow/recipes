// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Library } from './Library';

vi.mock('../api', () => ({
  listRecipes: vi.fn(),
  listTags: vi.fn(),
}));
import { listRecipes, listTags } from '../api';

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(listRecipes).mockReset().mockResolvedValue([
    { id: 'a', title: 'Carbonara', origin: 'mine', sourceName: null, tags: ['Pasta'], thumbnailId: null, totalMinutes: 90 },
    { id: 'b', title: 'Dal', origin: 'other', sourceName: 'BBC', tags: [], thumbnailId: 'img1', totalMinutes: 45 },
  ]);
  vi.mocked(listTags).mockReset().mockResolvedValue(['Pasta']);
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
