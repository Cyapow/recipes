// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Settings } from './Settings';
import type { BackupStatus } from '../api';

vi.mock('../api', () => ({ getBackupStatus: vi.fn(), runBackupNow: vi.fn(), disconnectGoogle: vi.fn() }));
import { disconnectGoogle, getBackupStatus, runBackupNow } from '../api';

afterEach(cleanup);
const connected: BackupStatus = {
  configured: true, connected: true, account: 'me@x.com', banner: 'none',
  lastRunAt: '2026-03-10T01:00:00.000Z', lastSuccessAt: null, lastError: 'boom', running: false,
};
beforeEach(() => {
  vi.mocked(getBackupStatus).mockReset().mockResolvedValue(connected);
  vi.mocked(runBackupNow).mockReset();
  vi.mocked(disconnectGoogle).mockReset();
});
const show = () => render(<MemoryRouter><Settings /></MemoryRouter>);

describe('Settings', () => {
  it('shows the account, last run/success/error', async () => {
    show();
    expect(await screen.findByText('me@x.com')).toBeTruthy();
    expect(screen.getByText('boom')).toBeTruthy();
    expect(screen.getByText('Never')).toBeTruthy();
  });

  it('not connected: connect link to the start route', async () => {
    vi.mocked(getBackupStatus).mockResolvedValue({ ...connected, connected: false, account: null });
    show();
    const a = await screen.findByRole('link', { name: 'Connect Google account' });
    expect(a.getAttribute('href')).toBe('/api/backup/google/start');
    expect(screen.getByText('Not connected')).toBeTruthy();
  });

  it('not configured shows the setup pointer', async () => {
    vi.mocked(getBackupStatus).mockResolvedValue({ ...connected, configured: false, connected: false, account: null });
    show();
    expect(await screen.findByText(/Google client isn't set up yet/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Connect Google account' })).toBeNull();
  });

  it('Back up now is guarded while in flight, shows the result and refreshes status', async () => {
    let finish!: (v: any) => void;
    vi.mocked(runBackupNow).mockReturnValue(new Promise((r) => (finish = r)));
    const user = userEvent.setup();
    show();
    const btn = await screen.findByRole('button', { name: 'Back up now' });
    await user.click(btn);
    await user.click(screen.getByRole('button', { name: /Backing up/ }));
    expect(runBackupNow).toHaveBeenCalledTimes(1);
    finish({ ok: true, uploadedImages: 3, snapshot: 's' });
    expect(await screen.findByText(/3 new images uploaded/)).toBeTruthy();
    await waitFor(() => expect(getBackupStatus).toHaveBeenCalledTimes(2));
  });

  it('failure shows the error', async () => {
    vi.mocked(runBackupNow).mockResolvedValue({ ok: false, error: 'A backup is already running' });
    const user = userEvent.setup();
    show();
    await user.click(await screen.findByRole('button', { name: 'Back up now' }));
    expect((await screen.findByRole('alert')).textContent).toContain('A backup is already running');
  });

  it('Disconnect asks for confirmation', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.mocked(disconnectGoogle).mockResolvedValue();
    show();
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(disconnectGoogle).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(disconnectGoogle).toHaveBeenCalledTimes(1));
    confirm.mockRestore();
  });
});
