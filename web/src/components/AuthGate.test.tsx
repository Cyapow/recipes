// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ApiError } from '../api';
import { AuthGate } from './AuthGate';
import { rememberSignedIn, wasSignedIn } from '../lib/session';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  getMe: vi.fn(),
  getAuthConfig: vi.fn().mockResolvedValue({ clientId: null }),
}));
import { getMe } from '../api';

const view = () => render(<AuthGate><p>the app</p></AuthGate>);

beforeEach(() => { localStorage.clear(); vi.mocked(getMe).mockReset(); });
afterEach(cleanup);

describe('AuthGate', () => {
  it('renders the app when /api/auth/me succeeds', async () => {
    vi.mocked(getMe).mockResolvedValue({ email: 'a@b.c' });
    view();
    expect(await screen.findByText('the app')).toBeTruthy();
    expect(screen.queryByText(/offline/i)).toBeNull();
  });

  it('renders the sign-in screen on a 401 and clears the remembered flag', async () => {
    rememberSignedIn();
    vi.mocked(getMe).mockRejectedValue(new ApiError('Request failed (401)', 401));
    view();
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
    expect(wasSignedIn()).toBe(false);
  });

  it('keeps the app and shows an offline notice when the call fails with a network error and we were signed in', async () => {
    rememberSignedIn();
    vi.mocked(getMe).mockRejectedValue(new TypeError('Failed to fetch'));
    view();
    expect(await screen.findByText('the app')).toBeTruthy();
    expect(screen.getByText(/offline/i)).toBeTruthy();
    expect(wasSignedIn()).toBe(true);
  });

  it('keeps the app on a server error too: only a 401 means signed out', async () => {
    rememberSignedIn();
    vi.mocked(getMe).mockRejectedValue(new ApiError('Request failed (502)', 502));
    view();
    expect(await screen.findByText('the app')).toBeTruthy();
    expect(screen.getByText(/offline/i)).toBeTruthy();
  });

  it('shows the sign-in screen on a network error when we were never signed in', async () => {
    vi.mocked(getMe).mockRejectedValue(new TypeError('Failed to fetch'));
    view();
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
  });
});
