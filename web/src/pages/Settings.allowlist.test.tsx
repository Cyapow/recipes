// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from './Settings';
import { onUnauthorized } from '../lib/session';

vi.mock('../api', () => {
  class ApiError extends Error {
    constructor(message: string, readonly status: number, readonly body?: unknown) {
      super(message);
    }
  }
  return {
    ApiError,
    getBackupStatus: vi.fn(), runBackupNow: vi.fn(), disconnectGoogle: vi.fn(), getAiStatus: vi.fn(),
    getMe: vi.fn(), listAllowed: vi.fn(), addAllowed: vi.fn(), removeAllowed: vi.fn(), signOut: vi.fn(),
  };
});
import { ApiError, addAllowed, getAiStatus, getBackupStatus, getMe, listAllowed, removeAllowed, signOut } from '../api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const rows = [
  { email: 'me@x.com', addedAt: '2026-03-01T00:00:00.000Z', fromEnv: true },
  { email: 'wife@x.com', addedAt: '2026-03-02T00:00:00.000Z', fromEnv: false },
];
beforeEach(() => {
  vi.mocked(getBackupStatus).mockReset().mockResolvedValue({
    configured: false, connected: false, banner: 'none',
    lastRunAt: null, lastSuccessAt: null, lastError: null, lastUploadAt: null, running: false,
  } as never);
  vi.mocked(getAiStatus).mockReset().mockResolvedValue({ providers: [], active: null });
  vi.mocked(getMe).mockReset().mockResolvedValue({ email: 'me@x.com', name: 'Me' });
  vi.mocked(listAllowed).mockReset().mockResolvedValue(rows);
  vi.mocked(addAllowed).mockReset().mockResolvedValue(undefined);
  vi.mocked(removeAllowed).mockReset().mockResolvedValue(undefined);
  vi.mocked(signOut).mockReset().mockResolvedValue(undefined);
});
const show = () => render(<MemoryRouter><Settings /></MemoryRouter>);
const item = async (email: string) => (await screen.findByText(email)).closest('li') as HTMLElement;

describe('Settings: who can get in', () => {
  it('lists who can get in, and who you are', async () => {
    show();
    const mine = await item('me@x.com');
    expect(within(mine).getByText('(you)')).toBeTruthy();
    const hers = await item('wife@x.com');
    expect(within(hers).queryByText('(you)')).toBeNull();
  });

  it('adds an address and refreshes the list', async () => {
    const user = userEvent.setup();
    show();
    await screen.findByText('wife@x.com');
    vi.mocked(listAllowed).mockResolvedValue([...rows, { email: 'kid@x.com', addedAt: '2026-03-03T00:00:00.000Z', fromEnv: false }]);
    await user.type(screen.getByLabelText('Email address'), 'kid@x.com');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(addAllowed).toHaveBeenCalledWith('kid@x.com');
    expect(await screen.findByText('kid@x.com')).toBeTruthy();
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('');
  });

  it('shows the server message when an add is refused', async () => {
    vi.mocked(addAllowed).mockRejectedValue(new ApiError('x', 400, { error: "That doesn't look like an email address" }));
    const user = userEvent.setup();
    show();
    await screen.findByText('wife@x.com');
    await user.type(screen.getByLabelText('Email address'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect((await screen.findByRole('alert')).textContent).toBe("That doesn't look like an email address");
  });

  it('shows the server refusal when a removal is rejected', async () => {
    const msg = "That's you. Someone else has to remove your access.";
    vi.mocked(removeAllowed).mockRejectedValue(new ApiError('x', 409, { error: msg }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    show();
    await user.click(within(await item('wife@x.com')).getByRole('button', { name: /remove/i }));
    expect((await screen.findByRole('alert')).textContent).toBe(msg);
  });

  it('has no remove button for an address set in .env', async () => {
    show();
    const mine = await item('me@x.com');
    expect(within(mine).queryByRole('button')).toBeNull();
    expect(within(await item('wife@x.com')).getByRole('button', { name: /remove/i })).toBeTruthy();
  });

  it('confirms before removing, and does nothing when dismissed', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    show();
    const btn = within(await item('wife@x.com')).getByRole('button', { name: /remove/i });
    await user.click(btn);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(removeAllowed).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await user.click(btn);
    await waitFor(() => expect(removeAllowed).toHaveBeenCalledWith('wife@x.com'));
  });

  it('treats a 401 from sign-out as already signed out instead of dead-ending', async () => {
    vi.mocked(signOut).mockRejectedValue(new ApiError('Request failed (401)', 401));
    const back = vi.fn();
    const off = onUnauthorized(back);
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(back).toHaveBeenCalled());
    expect(screen.queryByText('Could not sign out. Try again.')).toBeNull();
    off();
  });

  it('says so when sign-out fails for any other reason', async () => {
    vi.mocked(signOut).mockRejectedValue(new ApiError('Request failed (500)', 500));
    const back = vi.fn();
    const off = onUnauthorized(back);
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not sign out. Try again.');
    expect(back).not.toHaveBeenCalled();
    off();
  });

  it('signs out', async () => {
    const back = vi.fn();
    const off = onUnauthorized(back);
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
    await waitFor(() => expect(back).toHaveBeenCalled());
    off();
  });
});
