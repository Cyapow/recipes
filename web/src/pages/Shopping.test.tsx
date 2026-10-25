// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Shopping } from './Shopping';

vi.mock('../api', () => ({ listShopping: vi.fn(), removeShoppingItem: vi.fn(), clearShopping: vi.fn() }));
vi.mock('../lib/share', async (orig) => ({ ...(await orig<typeof import('../lib/share')>()), shareText: vi.fn() }));
import { clearShopping, listShopping, removeShoppingItem } from '../api';
import { shareText } from '../lib/share';

const item = (id: string, text: string, sources: { recipeId: string; title: string }[]) =>
  ({ id, text, item: text, quantity: null, unit: null, sources }) as never;
const A = { recipeId: 'a', title: 'Our spag bol' };
const B = { recipeId: 'b', title: 'Thai green curry' };
const LIST = [item('1', '2 tins chopped tomatoes', [A, B]), item('2', '500g beef mince', [A])];

const view = () => render(<MemoryRouter><Shopping /></MemoryRouter>);

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  vi.mocked(listShopping).mockReset().mockResolvedValue(LIST);
  vi.mocked(removeShoppingItem).mockReset().mockResolvedValue(undefined);
  vi.mocked(clearShopping).mockReset().mockResolvedValue(undefined);
  vi.mocked(shareText).mockReset();
});

describe('Shopping', () => {
  it('renders items, sources and the count line', async () => {
    view();
    expect(await screen.findByText('2 tins chopped tomatoes')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Shopping list' })).toBeTruthy();
    expect(screen.getByText('2 items from 2 recipes')).toBeTruthy();
    expect(screen.getByText('Our spag bol, Thai green curry')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to library' }).getAttribute('href')).toBe('/');
  });
  it('uses singular forms', async () => {
    vi.mocked(listShopping).mockResolvedValue([LIST[1]]);
    view();
    expect(await screen.findByText('1 item from 1 recipe')).toBeTruthy();
  });
  it('removes an item and keeps the others', async () => {
    const user = userEvent.setup();
    view();
    await screen.findByText('500g beef mince');
    await user.click(screen.getByRole('button', { name: 'Remove 500g beef mince' }));
    expect(removeShoppingItem).toHaveBeenCalledWith('2');
    await waitFor(() => expect(screen.queryByText('500g beef mince')).toBeNull());
    expect(screen.getByText('2 tins chopped tomatoes')).toBeTruthy();
  });
  it('keeps the row and shows an error when remove fails', async () => {
    vi.mocked(removeShoppingItem).mockRejectedValue(new Error('x'));
    const user = userEvent.setup();
    view();
    await screen.findByText('500g beef mince');
    await user.click(screen.getByRole('button', { name: 'Remove 500g beef mince' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not remove/);
    expect(screen.getByText('500g beef mince')).toBeTruthy();
  });
  it('needs a second tap to clear', async () => {
    const user = userEvent.setup();
    view();
    await screen.findByText('500g beef mince');
    await user.click(screen.getByRole('button', { name: 'Clear list' }));
    expect(clearShopping).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Tap again to clear' }));
    expect(clearShopping).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Nothing here yet/)).toBeTruthy();
  });
  it('resets the clear confirmation after 4 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    view();
    await screen.findByText('500g beef mince');
    fireEvent.click(screen.getByRole('button', { name: 'Clear list' }));
    expect(screen.getByRole('button', { name: 'Tap again to clear' })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.getByRole('button', { name: 'Clear list' })).toBeTruthy();
    expect(clearShopping).not.toHaveBeenCalled();
  });
  it('shares one item per line and shows nothing for shared/cancelled', async () => {
    const user = userEvent.setup();
    vi.mocked(shareText).mockResolvedValue('cancelled');
    view();
    await screen.findByText('500g beef mince');
    await user.click(screen.getByRole('button', { name: 'Share list' }));
    expect(shareText).toHaveBeenCalledWith('2 tins chopped tomatoes\n500g beef mince');
    await waitFor(() => expect(vi.mocked(shareText)).toHaveBeenCalled());
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('says copied', async () => {
    const user = userEvent.setup();
    vi.mocked(shareText).mockResolvedValue('copied');
    view();
    await screen.findByText('500g beef mince');
    await user.click(screen.getByRole('button', { name: 'Share list' }));
    expect(await screen.findByText('Copied to the clipboard')).toBeTruthy();
  });
  it('shows a read-only textarea for manual', async () => {
    const user = userEvent.setup();
    vi.mocked(shareText).mockResolvedValue('manual');
    view();
    await screen.findByText('500g beef mince');
    await user.click(screen.getByRole('button', { name: 'Share list' }));
    const box = (await screen.findByRole('textbox')) as HTMLTextAreaElement;
    expect(box.readOnly).toBe(true);
    expect(box.value).toBe('2 tins chopped tomatoes\n500g beef mince');
    expect(screen.getByText('Copy this list')).toBeTruthy();
  });
  it('ignores repeated Share taps while in flight', async () => {
    const user = userEvent.setup();
    let done!: (v: 'shared') => void;
    vi.mocked(shareText).mockReturnValue(new Promise((r) => { done = r; }));
    view();
    await screen.findByText('500g beef mince');
    const btn = screen.getByRole('button', { name: 'Share list' });
    await user.click(btn);
    await user.click(btn);
    expect(shareText).toHaveBeenCalledTimes(1);
    await act(async () => done('shared'));
  });
  it('shows the empty state with a library link, and Share says nothing to share', async () => {
    vi.mocked(listShopping).mockResolvedValue([]);
    const user = userEvent.setup();
    view();
    expect(await screen.findByText('Nothing here yet. Open a recipe and tick what you already have.')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /library/i }).some((l) => l.getAttribute('href') === '/')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Share list' }));
    expect(screen.getByRole('status').textContent).toBe('Nothing to share');
    expect(shareText).not.toHaveBeenCalled();
  });
  it('shows a load error with Retry', async () => {
    vi.mocked(listShopping).mockRejectedValueOnce(new Error('x'));
    const user = userEvent.setup();
    view();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not load the shopping list/);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('500g beef mince')).toBeTruthy();
  });
  it('refetches on focus and on becoming visible', async () => {
    view();
    await screen.findByText('500g beef mince');
    expect(listShopping).toHaveBeenCalledTimes(1);
    vi.mocked(listShopping).mockResolvedValue([item('3', 'milk', [B])]);
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByText('milk')).toBeTruthy();
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(listShopping).toHaveBeenCalledTimes(3));
  });
  it('ignores a stale response', async () => {
    let first!: (v: never[]) => void;
    vi.mocked(listShopping)
      .mockReset()
      .mockReturnValueOnce(new Promise((r) => { first = r as never; }))
      .mockResolvedValueOnce([item('3', 'milk', [B])]);
    view();
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByText('milk')).toBeTruthy();
    await act(async () => first([item('9', 'stale thing', [A])] as never));
    expect(screen.queryByText('stale thing')).toBeNull();
  });
});
