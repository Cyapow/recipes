// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BackupBanner } from './BackupBanner';

afterEach(cleanup);
const r = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('BackupBanner', () => {
  it('not_connected', () => {
    r(<BackupBanner banner="not_connected" />);
    expect(screen.getByRole('status').textContent).toContain('Not backed up yet. Connect Google Drive in Settings.');
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
  });
  it('failed shows the error as an alert', () => {
    r(<BackupBanner banner="failed" lastError="Google Drive authorisation failed - reconnect Drive" />);
    expect(screen.getByRole('alert').textContent).toContain('Last backup failed: Google Drive authorisation failed - reconnect Drive');
    expect(screen.getByRole('link').getAttribute('href')).toBe('/settings');
  });
  it('stale', () => {
    r(<BackupBanner banner="stale" />);
    expect(screen.getByRole('status').textContent).toContain('No successful backup in over 36 hours.');
    expect(screen.getByRole('link').getAttribute('href')).toBe('/settings');
  });
  it('none renders nothing', () => {
    const { container } = r(<BackupBanner banner="none" />);
    expect(container.innerHTML).toBe('');
  });
});
