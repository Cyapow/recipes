// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GSI_TIMEOUT_MS, SignIn } from './SignIn';
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
afterEach(() => { cleanup(); vi.useRealTimers(); delete (window as unknown as { google?: unknown }).google; });

const theScript = async () => {
  await waitFor(() => expect(document.querySelectorAll(SCRIPT).length).toBe(1));
  return document.querySelector(SCRIPT) as HTMLScriptElement;
};
const googleAppears = () => {
  (window as unknown as { google: unknown }).google = {
    accounts: { id: { initialize: (o: { callback: Callback }) => { callback = o.callback; }, renderButton, prompt } },
  };
};

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

  it('inserts the Google script only once when mounted again, and still settles when it loads', async () => {
    delete (window as unknown as { google?: unknown }).google;
    render(<SignIn onSignedIn={vi.fn()} />);
    const script = await theScript();
    cleanup();
    render(<SignIn onSignedIn={vi.fn()} />);
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalledTimes(2));
    expect(document.querySelectorAll(SCRIPT).length).toBe(1);
    // The second mount adopted the existing node, so its listeners must still be able to fire.
    googleAppears();
    await act(async () => { script.dispatchEvent(new Event('load')); });
    await waitFor(() => expect(renderButton).toHaveBeenCalled());
  });

  it('drops a failed script node so a retry starts a fresh request instead of hanging', async () => {
    delete (window as unknown as { google?: unknown }).google;
    render(<SignIn onSignedIn={vi.fn()} />);
    const script = await theScript();
    await act(async () => { script.dispatchEvent(new Event('error')); });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't reach Google/);
    expect(document.querySelectorAll(SCRIPT).length).toBe(0);

    googleAppears();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(renderButton).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the same error when the script request hangs instead of failing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    delete (window as unknown as { google?: unknown }).google;
    render(<SignIn onSignedIn={vi.fn()} />);
    await theScript();
    await act(async () => { await vi.advanceTimersByTimeAsync(GSI_TIMEOUT_MS); });
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't reach Google/);
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(document.querySelectorAll(SCRIPT).length).toBe(0);
  });

  it('offers no retry for an account the server turns away', async () => {
    vi.mocked(signInWithGoogle).mockRejectedValue(
      new ApiError('Request failed (403)', 403, { error: "This Google account isn't on the list" }),
    );
    render(<SignIn onSignedIn={vi.fn()} />);
    await waitFor(() => expect(callback).toBeDefined());
    callback!({ credential: 'bad' });
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });
});
