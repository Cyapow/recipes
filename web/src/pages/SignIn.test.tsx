// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { SignIn } from './SignIn';
import { wasSignedIn } from '../lib/session';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  getAuthConfig: vi.fn(),
  signInWithGoogle: vi.fn(),
}));
import { ApiError, getAuthConfig, signInWithGoogle } from '../api';

type Callback = (r: { credential: string }) => void;
let callback: Callback | undefined;
const renderButton = vi.fn();
const prompt = vi.fn();
const SCRIPT = 'script[src="https://accounts.google.com/gsi/client"]';

beforeEach(() => {
  localStorage.clear();
  callback = undefined;
  renderButton.mockReset();
  prompt.mockReset();
  vi.mocked(getAuthConfig).mockReset().mockResolvedValue({ clientId: 'client-123' });
  vi.mocked(signInWithGoogle).mockReset();
  document.head.querySelectorAll(SCRIPT).forEach((s) => s.remove());
  (window as unknown as { google: unknown }).google = {
    accounts: { id: { initialize: (o: { callback: Callback }) => { callback = o.callback; }, renderButton, prompt } },
  };
});
afterEach(() => { cleanup(); delete (window as unknown as { google?: unknown }).google; });

describe('SignIn', () => {
  it('posts the credential from the Google callback and remembers the session', async () => {
    vi.mocked(signInWithGoogle).mockResolvedValue({ email: 'a@b.c' });
    const onSignedIn = vi.fn();
    render(<SignIn onSignedIn={onSignedIn} />);
    await waitFor(() => expect(renderButton).toHaveBeenCalled());
    expect(renderButton.mock.calls[0][1]).toEqual({ theme: 'outline', size: 'large' });
    callback!({ credential: 'good' });
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(signInWithGoogle).toHaveBeenCalledWith('good');
    expect(wasSignedIn()).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('shows the 403 message from the server without dressing it up', async () => {
    vi.mocked(signInWithGoogle).mockRejectedValue(
      new ApiError('Request failed (403)', 403, { error: "This Google account isn't on the list" }),
    );
    const onSignedIn = vi.fn();
    render(<SignIn onSignedIn={onSignedIn} />);
    await waitFor(() => expect(callback).toBeDefined());
    callback!({ credential: 'bad' });
    expect((await screen.findByRole('alert')).textContent).toBe("This Google account isn't on the list");
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(wasSignedIn()).toBe(false);
  });

  it('explains it when the server has no client ID configured', async () => {
    vi.mocked(getAuthConfig).mockResolvedValue({ clientId: null });
    render(<SignIn onSignedIn={vi.fn()} />);
    expect(await screen.findByText(/isn't set up for Google sign-in/i)).toBeTruthy();
    expect(renderButton).not.toHaveBeenCalled();
  });

  it('inserts the Google script only once, even when mounted again', async () => {
    delete (window as unknown as { google?: unknown }).google;
    render(<SignIn onSignedIn={vi.fn()} />);
    await waitFor(() => expect(document.querySelectorAll(SCRIPT).length).toBe(1));
    cleanup();
    render(<SignIn onSignedIn={vi.fn()} />);
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalledTimes(2));
    expect(document.querySelectorAll(SCRIPT).length).toBe(1);
  });
});
