// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../api';
import { AuthGate } from './AuthGate';
import { rememberSignedIn, wasSignedIn } from '../lib/session';
import { useMe } from '../lib/me';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  getMe: vi.fn(),
  getAuthConfig: vi.fn().mockResolvedValue({ clientId: null }),
}));
import { getMe, listRecipes } from '../api';

const view = () => render(<AuthGate><p>the app</p></AuthGate>);

beforeEach(() => { localStorage.clear(); vi.mocked(getMe).mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AuthGate', () => {
  it('renders the app when /api/auth/me succeeds', async () => {
    vi.mocked(getMe).mockResolvedValue({ email: 'a@b.c', name: 'A' });
    view();
    expect(await screen.findByText('the app')).toBeTruthy();
    expect(screen.queryByText(/offline/i)).toBeNull();
  });

  it('tells the app who is signed in', async () => {
    vi.mocked(getMe).mockResolvedValue({ email: 'a@b.c', name: 'Ann' });
    function Who() { return <p>{useMe()?.name ?? 'nobody'}</p>; }
    render(<AuthGate><Who /></AuthGate>);
    expect(await screen.findByText('Ann')).toBeTruthy();
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
    expect(await screen.findByText(/offline/i)).toBeTruthy();
    expect(wasSignedIn()).toBe(true);
  });

  it('keeps the app on a server error too: only a 401 means signed out', async () => {
    rememberSignedIn();
    vi.mocked(getMe).mockRejectedValue(new ApiError('Request failed (502)', 502));
    view();
    expect(await screen.findByText('the app')).toBeTruthy();
    // The app shows at once (we were signed in); the notice only follows once getMe() has rejected.
    expect(await screen.findByText(/offline/i)).toBeTruthy();
  });

  it('renders the app at once while a hung getMe() never settles, if we were signed in', async () => {
    rememberSignedIn();
    vi.mocked(getMe).mockReturnValue(new Promise<{ email: string; name: string }>(() => {})); // a hung socket: no resolve, no reject
    view();
    expect(screen.getByText('the app')).toBeTruthy();
    expect(screen.queryByText(/Loading/)).toBeNull();
    expect(screen.queryByRole('heading', { name: /sign in/i })).toBeNull();
  });

  it('waits on getMe() when we were never signed in', () => {
    vi.mocked(getMe).mockReturnValue(new Promise<{ email: string; name: string }>(() => {}));
    view();
    expect(screen.getByText(/Loading/)).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
  });

  it('re-checks when the browser comes back online and drops the offline notice', async () => {
    rememberSignedIn();
    vi.mocked(getMe).mockRejectedValue(new TypeError('Failed to fetch'));
    view();
    expect(await screen.findByText(/offline/i)).toBeTruthy();
    vi.mocked(getMe).mockResolvedValue({ email: 'a@b.c', name: 'A' });
    await act(async () => { window.dispatchEvent(new Event('online')); });
    // The notice goes only once the re-check's promise has resolved and React has re-rendered.
    await waitFor(() => expect(screen.queryByText(/offline/i)).toBeNull());
    expect(screen.getByText('the app')).toBeTruthy();
  });

  it('shows the sign-in screen on a network error when we were never signed in', async () => {
    vi.mocked(getMe).mockRejectedValue(new TypeError('Failed to fetch'));
    view();
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
  });

  describe('a data call failing while the app is showing', () => {
    // The real listRecipes goes through the real fetch wrapper; only fetch is stubbed.
    const app = () => render(
      <AuthGate><button onClick={() => { listRecipes().catch(() => {}); }}>load</button></AuthGate>,
    );
    const stubFetch = (res: () => Response | Promise<Response>) => vi.stubGlobal('fetch', vi.fn(async () => res()));

    beforeEach(() => vi.mocked(getMe).mockResolvedValue({ email: 'a@b.c', name: 'A' }));

    it('a 401 mid-session replaces the app with the sign-in screen and clears the flag', async () => {
      app();
      await screen.findByText('load');
      rememberSignedIn();
      stubFetch(() => new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }));
      await act(async () => { await userEvent.click(screen.getByText('load')); });
      expect(await screen.findByRole('heading', { name: /sign in/i })).toBeTruthy();
      expect(screen.queryByText('load')).toBeNull();
      expect(wasSignedIn()).toBe(false);
    });

    it('a 500 leaves the app showing', async () => {
      app();
      await screen.findByText('load');
      rememberSignedIn();
      stubFetch(() => new Response('boom', { status: 500 }));
      await act(async () => { await userEvent.click(screen.getByText('load')); });
      expect(screen.getByText('load')).toBeTruthy();
      expect(screen.queryByRole('heading', { name: /sign in/i })).toBeNull();
      expect(wasSignedIn()).toBe(true);
    });

    it('a network failure leaves the app showing', async () => {
      app();
      await screen.findByText('load');
      rememberSignedIn();
      stubFetch(() => { throw new TypeError('Failed to fetch'); });
      await act(async () => { await userEvent.click(screen.getByText('load')); });
      expect(screen.getByText('load')).toBeTruthy();
      expect(screen.queryByRole('heading', { name: /sign in/i })).toBeNull();
      expect(wasSignedIn()).toBe(true);
    });
  });
});
