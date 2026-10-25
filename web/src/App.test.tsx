// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from './App';

vi.mock('./api', () => ({ listShopping: vi.fn().mockResolvedValue([]) }));
afterEach(cleanup);

describe('App routes', () => {
  it('renders the shopping list at /shopping', async () => {
    render(<MemoryRouter initialEntries={['/shopping']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Shopping list' })).toBeTruthy();
  });

  it('renders Page not found with a link back for an unknown URL', () => {
    render(<MemoryRouter initialEntries={['/nope/at/all']}><App /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to library' }).getAttribute('href')).toBe('/');
  });

  it('does not show Page not found on a known route', async () => {
    render(<MemoryRouter initialEntries={['/shopping']}><App /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Shopping list' });
    expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull();
  });
});
