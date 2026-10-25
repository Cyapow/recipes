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
});
