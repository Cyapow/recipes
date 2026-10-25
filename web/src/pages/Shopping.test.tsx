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
    await new Promise((r) => setTimeout(r, 560));
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
  it('refetches on focus and on becoming visible, deduping events fired together', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    view();
    await screen.findByText('500g beef mince');
    expect(listShopping).toHaveBeenCalledTimes(1);
    now += 1000;
    vi.mocked(listShopping).mockResolvedValue([item('3', 'milk', [B])]);
    act(() => { window.dispatchEvent(new Event('focus')); });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(await screen.findByText('milk')).toBeTruthy();
    expect(listShopping).toHaveBeenCalledTimes(2);
    now += 1000;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(listShopping).toHaveBeenCalledTimes(3));
    vi.restoreAllMocks();
  });
  it('ignores a stale response', async () => {
    let first!: (v: never[]) => void;
    vi.mocked(listShopping)
      .mockReset()
      .mockReturnValueOnce(new Promise((r) => { first = r as never; }))
      .mockResolvedValueOnce([item('3', 'milk', [B])]);
    let now = 5_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    view();
    now += 1000;
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByText('milk')).toBeTruthy();
    await act(async () => first([item('9', 'stale thing', [A])] as never));
    expect(screen.queryByText('stale thing')).toBeNull();
  });

  it('sends both removes when different rows are tapped back-to-back, and one for the same row', async () => {
    let r1!: () => void;
    vi.mocked(removeShoppingItem)
      .mockReturnValueOnce(new Promise<void>((r) => { r1 = r; }))
      .mockResolvedValue(undefined);
    view();
    await screen.findByText('500g beef mince');
    const first = screen.getByRole('button', { name: 'Remove 2 tins chopped tomatoes' });
    fireEvent.click(first);
    fireEvent.click(first);
    fireEvent.click(screen.getByRole('button', { name: 'Remove 500g beef mince' }));
    expect(removeShoppingItem).toHaveBeenCalledTimes(2);
    expect(vi.mocked(removeShoppingItem).mock.calls.map((c) => c[0])).toEqual(['1', '2']);
    expect(first.getAttribute('aria-busy')).toBe('true');
    await act(async () => r1());
    await waitFor(() => expect(screen.queryByText('2 tins chopped tomatoes')).toBeNull());
  });
  it('a failed remove keeps only that row', async () => {
    vi.mocked(removeShoppingItem).mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    view();
    await screen.findByText('500g beef mince');
    fireEvent.click(screen.getByRole('button', { name: 'Remove 2 tins chopped tomatoes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove 500g beef mince' }));
    await waitFor(() => expect(screen.queryByText('500g beef mince')).toBeNull());
    expect(screen.getByText('2 tins chopped tomatoes')).toBeTruthy();
  });
  it('moves focus to the next row, then the heading, and announces removal', async () => {
    vi.mocked(listShopping).mockResolvedValue([item('1', 'a', [A]), item('2', 'b', [A]), item('3', 'c', [A])]);
    const user = userEvent.setup();
    view();
    await screen.findByText('b');
    await user.click(screen.getByRole('button', { name: 'Remove b' }));
    await waitFor(() => expect(screen.queryByText('b')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove c' }));
    expect(screen.getByRole('status').textContent).toBe('Removed b');
    await user.click(screen.getByRole('button', { name: 'Remove c' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove a' })));
    await user.click(screen.getByRole('button', { name: 'Remove a' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Shopping list' })));
  });
  it('labels the manual textarea', async () => {
    const user = userEvent.setup();
    vi.mocked(shareText).mockResolvedValue('manual');
    view();
    await screen.findByText('500g beef mince');
    await user.click(screen.getByRole('button', { name: 'Share list' }));
    const box = (await screen.findByRole('textbox', { name: 'Shopping list text, copy this' })) as HTMLTextAreaElement;
    expect(box.value).toBe('2 tins chopped tomatoes\n500g beef mince');
    expect(box.getAttribute('aria-describedby')).toBe('manual-hint');
  });
  it('hides the manual textarea once the list changes', async () => {
    const user = userEvent.setup();
    vi.mocked(shareText).mockResolvedValue('manual');
    view();
    await screen.findByText('500g beef mince');
    await user.click(screen.getByRole('button', { name: 'Share list' }));
    await screen.findByRole('textbox');
    await user.click(screen.getByRole('button', { name: 'Remove 500g beef mince' }));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });
  it('omits the recipes clause when no recipe sources', async () => {
    vi.mocked(listShopping).mockResolvedValue([item('1', 'x', [])]);
    view();
    expect(await screen.findByText('1 item')).toBeTruthy();
  });
  it('shows a non-blocking line when a refresh fails with a list showing', async () => {
    let now = 9_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    view();
    await screen.findByText('500g beef mince');
    now += 1000;
    vi.mocked(listShopping).mockRejectedValue(new Error('x'));
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByText("Couldn't refresh the list")).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('500g beef mince')).toBeTruthy();
    vi.restoreAllMocks();
  });
  it('a stale refetch cannot resurrect a removed row', async () => {
    let now = 7_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    view();
    await screen.findByText('500g beef mince');
    let late!: (v: never) => void;
    vi.mocked(listShopping).mockReturnValueOnce(new Promise((r) => { late = r as never; }));
    now += 1000;
    act(() => { window.dispatchEvent(new Event('focus')); });
    fireEvent.click(screen.getByRole('button', { name: 'Remove 500g beef mince' }));
    await waitFor(() => expect(screen.queryByText('500g beef mince')).toBeNull());
    await act(async () => late(LIST as never));
    expect(screen.queryByText('500g beef mince')).toBeNull();
    vi.restoreAllMocks();
  });
});

describe('Shopping clear confirmation', () => {
  const arm = async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const r = view();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.click(screen.getByRole('button', { name: 'Clear list' }));
    return r;
  };
  it('ignores a second tap within 500 ms, accepts one at 600 ms', async () => {
    await arm();
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to clear' }));
    expect(clearShopping).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to clear' }));
    expect(clearShopping).toHaveBeenCalledTimes(1);
  });
  it('resets on blur', async () => {
    await arm();
    fireEvent.blur(screen.getByRole('button', { name: 'Tap again to clear' }));
    expect(screen.getByRole('button', { name: 'Clear list' })).toBeTruthy();
  });
  it('resets when a row is removed', async () => {
    await arm();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove 500g beef mince' })); });
    expect(screen.getByRole('button', { name: 'Clear list' })).toBeTruthy();
  });
  it('clears its timer on unmount', async () => {
    const { unmount } = await arm();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
