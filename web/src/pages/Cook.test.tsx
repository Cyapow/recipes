// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { Cook } from './Cook';
import type { Recipe } from '../api';

vi.mock('../api', () => ({ getRecipe: vi.fn() }));
import { getRecipe } from '../api';

const base: Recipe = {
  id: 'a', title: 'Bolognese', description: 'Classic.', origin: 'mine', sourceName: null, sourceUrl: null,
  servings: 4, prepMinutes: 5, cookMinutes: 60,
  ingredients: [
    { group: 'Base', quantity: 1, unit: null, item: 'onion', note: null },
    { group: 'Base', quantity: 500, unit: 'g', item: 'beef mince', note: null },
    { group: 'Sauce', quantity: 2, unit: 'tbsp', item: 'olive oil', note: null },
    { group: 'Sauce', quantity: 0.3333333333333333, unit: 'cup', item: 'red wine', note: 'dry' },
  ],
  steps: [
    { text: 'Dice the onion.', imageId: null, ingredients: [0] },
    { text: 'Brown the mince.', imageId: 'p2.jpg', ingredients: [1, 2] },
    { text: 'Simmer gently.', imageId: null, ingredients: [] },
  ],
  notes: 'Use good mince.', tags: ['Pasta'], imageIds: [], createdAt: '', updatedAt: '',
};

function Jump({ to }: { to: string }) {
  const nav = useNavigate();
  return <button onClick={() => nav(to)}>jump</button>;
}

function renderCook(path = '/recipe/a/cook') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Jump to="/recipe/b/cook" />
      <Routes>
        <Route path="/recipe/:id" element={<p>OVERVIEW</p>} />
        <Route path="/" element={<p>LIBRARY</p>} />
        <Route path="/recipe/:id/cook" element={<Cook />} />
      </Routes>
    </MemoryRouter>,
  );
}

type Sentinel = EventTarget & { release: ReturnType<typeof vi.fn>; released: boolean };
let sentinels: Sentinel[];
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  sentinels = [];
  localStorage.clear();
  vi.mocked(getRecipe).mockReset().mockResolvedValue(base);
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: vi.fn(async () => {
        const s = new EventTarget() as Sentinel;
        s.released = false;
        s.release = vi.fn(async () => { s.released = true; });
        sentinels.push(s);
        return s;
      }),
    },
  });
});
afterEach(() => {
  cleanup();
  delete (navigator as unknown as Record<string, unknown>).wakeLock;
});

const uses = () => screen.queryByRole('region', { name: 'Uses' });

describe('Cook slides', () => {
  it('shows header, step 1 text and only its linked ingredient', async () => {
    renderCook();
    expect(await screen.findByText('Step 1 of 3')).toBeTruthy();
    expect(screen.getByText('Dice the onion.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Leave cook mode' }).getAttribute('href')).toBe('/recipe/a');
    const u = within(uses()!);
    expect(u.getByText(/onion/)).toBeTruthy();
    expect(u.queryByText(/mince/)).toBeNull();
  });

  it('step 2 shows mince and oil, not onion; full list is not on the page', async () => {
    const user = userEvent.setup();
    renderCook();
    await screen.findByText('Dice the onion.');
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    const u = within(uses()!);
    expect(u.getByText(/500 g beef mince/)).toBeTruthy();
    expect(u.getByText(/2 tbsp olive oil/)).toBeTruthy();
    expect(u.queryByText(/onion/)).toBeNull();
    expect(screen.queryByText(/red wine/)).toBeNull();
  });

  it('renders no Uses strip when the step has no links', async () => {
    const user = userEvent.setup();
    renderCook();
    await screen.findByText('Dice the onion.');
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByText('Simmer gently.')).toBeTruthy();
    expect(uses()).toBeNull();
    expect(screen.queryByText('Uses')).toBeNull();
  });

  it('ignores out-of-range and non-integer linked indexes', async () => {
    vi.mocked(getRecipe).mockResolvedValue({
      ...base,
      steps: [{ text: 'Odd.', imageId: null, ingredients: [0, 9, -1, 1.5, NaN] as number[] }],
    });
    renderCook();
    await screen.findByText('Odd.');
    const u = within(uses()!);
    expect(u.getAllByRole('listitem')).toHaveLength(1);
    expect(u.getByText(/onion/)).toBeTruthy();
  });

  it('shows no Uses strip when every link is invalid', async () => {
    vi.mocked(getRecipe).mockResolvedValue({
      ...base,
      steps: [{ text: 'Odd.', imageId: null, ingredients: [42] }],
    });
    renderCook();
    await screen.findByText('Odd.');
    expect(uses()).toBeNull();
  });

  it('renders the step photo with src, alt and lazy loading; none without a photo', async () => {
    const user = userEvent.setup();
    renderCook();
    await screen.findByText('Dice the onion.');
    expect(screen.queryByRole('img')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    const img = screen.getByAltText('Photo for step 2') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/images/p2.jpg');
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('hides a photo that fails to load', async () => {
    const user = userEvent.setup();
    renderCook();
    await screen.findByText('Dice the onion.');
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    fireEvent.error(screen.getByAltText('Photo for step 2'));
    expect(screen.queryByAltText('Photo for step 2')).toBeNull();
    expect(screen.getByText('Brown the mince.')).toBeTruthy();
  });

  it('renders a photo-only step without an empty text paragraph', async () => {
    vi.mocked(getRecipe).mockResolvedValue({
      ...base, steps: [{ text: '', imageId: 'only.jpg', ingredients: [] }],
    });
    const { container } = renderCook();
    expect(await screen.findByAltText('Photo for step 1')).toBeTruthy();
    expect(container.querySelector('.cook-text')).toBeNull();
    expect(uses()).toBeNull();
  });

  it('renders a links-only step without an empty text paragraph', async () => {
    vi.mocked(getRecipe).mockResolvedValue({
      ...base, steps: [{ text: '  ', imageId: null, ingredients: [3] }],
    });
    const { container } = renderCook();
    await screen.findByText('Step 1 of 1');
    expect(within(uses()!).getByText(/0\.33 cup red wine \(dry\)/)).toBeTruthy();
    expect(container.querySelector('.cook-text')).toBeNull();
    expect(container.querySelectorAll('p').length).toBe(0);
  });

  it('marks the step text as a polite live region', async () => {
    renderCook();
    const text = await screen.findByText('Dice the onion.');
    expect(text.getAttribute('aria-live')).toBe('polite');
  });
});

describe('Cook navigation', () => {
  it('Back is aria-disabled on step 1 and does nothing', async () => {
    const user = userEvent.setup();
    renderCook();
    await screen.findByText('Dice the onion.');
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back.getAttribute('aria-disabled')).toBe('true');
    await user.click(back);
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
  });

  it('steps forward and back, and Done goes to the overview', async () => {
    const user = userEvent.setup();
    renderCook();
    await screen.findByText('Dice the onion.');
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByText('Simmer gently.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('OVERVIEW')).toBeTruthy();
  });

  it('has progress segments, one per step', async () => {
    const { container } = renderCook();
    await screen.findByText('Dice the onion.');
    expect(container.querySelectorAll('.cook-progress span')).toHaveLength(3);
    expect(container.querySelectorAll('.cook-progress span.done')).toHaveLength(1);
  });

  it('ArrowRight and ArrowLeft move between steps', async () => {
    renderCook();
    await screen.findByText('Dice the onion.');
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
  });

  it('ArrowRight on the last step does not leave', async () => {
    renderCook();
    await screen.findByText('Dice the onion.');
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByText('Step 3 of 3')).toBeTruthy();
  });

  it('ignores arrow keys typed in an input or textarea', async () => {
    renderCook();
    await screen.findByText('Dice the onion.');
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    document.body.append(input, area);
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    fireEvent.keyDown(area, { key: 'ArrowRight' });
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    input.remove();
    area.remove();
  });

  it('removes the key listener on unmount', async () => {
    const spy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderCook();
    await screen.findByText('Dice the onion.');
    unmount();
    expect(spy.mock.calls.some(([t]) => t === 'keydown')).toBe(true);
    spy.mockRestore();
  });

  it('swiping the slide area moves steps', async () => {
    const { container } = renderCook();
    await screen.findByText('Dice the onion.');
    const area = container.querySelector('.cook-body')!;
    const p = (x: number, y: number) => ({ clientX: x, clientY: y });
    fireEvent.touchStart(area, { touches: [p(250, 300)], changedTouches: [p(250, 300)] });
    fireEvent.touchEnd(area, { touches: [], changedTouches: [p(120, 310)] });
    expect(screen.getByText('Step 2 of 3')).toBeTruthy();
    fireEvent.touchStart(area, { touches: [p(120, 300)], changedTouches: [p(120, 300)] });
    fireEvent.touchEnd(area, { touches: [], changedTouches: [p(250, 300)] });
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
  });

  it('resets to step 1 when the recipe id changes', async () => {
    const user = userEvent.setup();
    vi.mocked(getRecipe).mockImplementation(async (rid: string) =>
      rid === 'b' ? { ...base, id: 'b', steps: [{ text: 'B first.', imageId: null, ingredients: [] }, { text: 'B second.', imageId: null, ingredients: [] }] } : base);
    renderCook();
    await screen.findByText('Dice the onion.');
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    await user.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByText('Step 3 of 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'jump' }));
    expect(await screen.findByText('B first.')).toBeTruthy();
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
  });
});

describe('Cook ingredients sheet', () => {
  it('opens a modal dialog listing all ingredients grouped, and closes with Close', async () => {
    const user = userEvent.setup();
    renderCook();
    await screen.findByText('Dice the onion.');
    expect(screen.queryByRole('dialog')).toBeNull();
    const opener = screen.getByRole('button', { name: 'Ingredients' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Ingredients' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const d = within(dialog);
    expect(d.getByText('Base')).toBeTruthy();
    expect(d.getByText('Sauce')).toBeTruthy();
    expect(d.getAllByRole('listitem')).toHaveLength(4);
    expect(d.getByText(/1 onion/)).toBeTruthy();
    expect(d.getByText(/500 g beef mince/)).toBeTruthy();
    expect(d.getByText(/2 tbsp olive oil/)).toBeTruthy();
    expect(d.getByText(/0\.33 cup red wine \(dry\)/)).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.click(d.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup();
    renderCook();
    await screen.findByText('Dice the onion.');
    const opener = screen.getByRole('button', { name: 'Ingredients' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('traps Tab inside the dialog and makes the background inert', async () => {
    const user = userEvent.setup();
    const { container } = renderCook();
    await screen.findByText('Dice the onion.');
    await user.click(screen.getByRole('button', { name: 'Ingredients' }));
    const dialog = screen.getByRole('dialog', { name: 'Ingredients' });
    const close = within(dialog).getByRole('button', { name: 'Close' });
    close.focus();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(container.querySelector('.cook-main')!.hasAttribute('inert')).toBe(true);
  });

  it('arrow keys do not change steps while the sheet is open', async () => {
    const user = userEvent.setup();
    renderCook();
    await screen.findByText('Dice the onion.');
    await user.click(screen.getByRole('button', { name: 'Ingredients' }));
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
  });
});

describe('Cook keep screen on', () => {
  it('shows the toggle and wires it to the wake lock', async () => {
    const user = userEvent.setup();
    renderCook();
    const toggle = (await screen.findByRole('checkbox', { name: 'Keep screen on' })) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    await user.click(toggle);
    expect(toggle.checked).toBe(true);
    expect(navigator.wakeLock.request).toHaveBeenCalledTimes(1);
  });

  it('shows a note instead of the toggle when unsupported', async () => {
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
    renderCook();
    await screen.findByText('Step 1 of 3');
    expect(screen.getByText("Your browser can't keep the screen on")).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Keep screen on' })).toBeNull();
  });

  it('releases the wake lock when leaving cook mode', async () => {
    localStorage.setItem('keepScreenOn', 'true');
    const { unmount } = renderCook();
    await screen.findByText('Step 1 of 3');
    await flush();
    expect(sentinels).toHaveLength(1);
    unmount();
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('releases the wake lock when navigating to the overview', async () => {
    localStorage.setItem('keepScreenOn', 'true');
    const user = userEvent.setup();
    renderCook();
    await screen.findByText('Step 1 of 3');
    await flush();
    await user.click(screen.getByRole('link', { name: 'Leave cook mode' }));
    expect(screen.getByText('OVERVIEW')).toBeTruthy();
    expect(sentinels[0].release).toHaveBeenCalled();
  });
});

describe('Cook states', () => {
  it('shows description and notes with a link back when there are no steps', async () => {
    vi.mocked(getRecipe).mockResolvedValue({ ...base, steps: [] });
    renderCook();
    await screen.findByText('Use good mince.');
    expect(screen.getByText('Classic.')).toBeTruthy();
    expect(screen.queryByText(/Step 1/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next step' })).toBeNull();
    expect(screen.getByRole('link', { name: /back to recipe/i }).getAttribute('href')).toBe('/recipe/a');
  });

  it('shows not-found with a link to the library', async () => {
    vi.mocked(getRecipe).mockRejectedValue(new Error('Request failed (404)'));
    renderCook();
    expect(await screen.findByText('Recipe not found')).toBeTruthy();
    expect(screen.getByRole('link', { name: /library/i }).getAttribute('href')).toBe('/');
  });

  it('shows an error with a link to the library on load failure', async () => {
    vi.mocked(getRecipe).mockRejectedValue(new Error('Request failed (500)'));
    renderCook();
    expect(await screen.findByText('Could not load recipe')).toBeTruthy();
    expect(screen.getByRole('link', { name: /library/i }).getAttribute('href')).toBe('/');
  });
});
