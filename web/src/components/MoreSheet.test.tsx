// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MoreSheet, type MoreItem } from './MoreSheet';

const items: MoreItem[] = [
  { to: '/planner', label: 'Meal planner', icon: null },
  { to: '/settings', label: 'Settings', icon: null },
];

const view = (open: boolean, onClose = vi.fn()) => {
  render(<MemoryRouter><MoreSheet open={open} items={items} onClose={onClose} /></MemoryRouter>);
  return onClose;
};

afterEach(cleanup);

describe('MoreSheet', () => {
  it('shows nothing until it is opened', () => {
    view(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists each place as a link, labelled in words rather than by its icon alone', () => {
    view(true);
    expect(screen.getByRole('link', { name: 'Meal planner' }).getAttribute('href')).toBe('/planner');
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
  });

  it('is a modal dialog that takes the focus, so a screen reader lands in it', () => {
    view(true);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'More' }));
  });

  it('closes on Escape', async () => {
    const onClose = view(true);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when the backdrop is tapped', async () => {
    const onClose = view(true);
    await userEvent.click(screen.getByTestId('more-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when a place is chosen, so coming back does not find it still open', async () => {
    const onClose = view(true);
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(onClose).toHaveBeenCalled();
  });
});
