// @vitest-environment jsdom
process.env.TZ = 'Europe/London';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Meal } from './Meal';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  getMeal: vi.fn(), scheduleMeal: vi.fn(), updateMeal: vi.fn(),
}));
import { getMeal, scheduleMeal, updateMeal } from '../api';

const stage = (over: object = {}) => ({
  id: 's1', recipeId: 'r1', offsetMinutes: 180, durationMinutes: 30, estimated: false, text: 'Brine the chicken',
  stepIndices: [0], doneAt: null, position: 0, at: '2026-12-06T10:30:00.000Z', clock: '10:30', dayGroup: 'on the day', ...over,
});
const meal = (stages: object[]) => ({
  id: 'm1', title: 'Sunday lunch', serveAt: '2026-12-06T13:30:00.000Z', serveText: 'Sunday 6 December 2026, 13:30', watchOut: [], scheduleStale: false,
  scheduledAt: '2026-12-01T10:00:00.000Z', createdAt: '', updatedAt: '',
  recipes: [{ id: 'mr1', recipeId: 'r1', recipeTitle: 'Roast chicken', course: 'main', position: 0 }],
  ingredients: [],
  stages,
}) as never;

const threeStages = () => [
  stage({ doneAt: '2026-12-06T10:40:00.000Z' }),
  stage({ id: 's2', text: 'Make the gravy', at: '2026-12-06T12:30:00.000Z', clock: '12:30', position: 1 }),
  stage({ id: 's3', text: 'Carve', recipeId: null, durationMinutes: null, at: '2026-12-06T13:20:00.000Z', clock: '13:20', position: 2 }),
];

const view = () =>
  render(
    <MemoryRouter initialEntries={['/meals/m1']}>
      <Routes>
        <Route path="/meals/:id" element={<Meal />} />
      </Routes>
    </MemoryRouter>,
  );

async function startFollowing() {
  const user = userEvent.setup();
  view();
  await user.click(await screen.findByRole('button', { name: 'Follow on the day' }));
  return user;
}
const section = (name: string) => screen.findByRole('region', { name });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-12-06T12:45:00.000Z'));
  localStorage.clear();
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request: vi.fn(async () => Object.assign(new EventTarget(), { release: vi.fn(async () => {}) })) },
  });
  vi.mocked(getMeal).mockReset().mockResolvedValue(meal(threeStages()));
  vi.mocked(scheduleMeal).mockReset().mockResolvedValue(meal(threeStages()));
  vi.mocked(updateMeal).mockReset().mockResolvedValue(meal(threeStages()));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (navigator as unknown as Record<string, unknown>).wakeLock;
});

describe('Meal live view', () => {
  it('shows what is due now, what is next, and what is done', async () => {
    await startFollowing();
    expect(within(await section('Due now')).getByText('Make the gravy')).toBeTruthy();
    expect(within(await section('Next')).getByText('Carve')).toBeTruthy();
    expect(within(await section('Done')).getByText('Brine the chicken')).toBeTruthy();
    // The clock is the server's own string, not formatted here.
    expect(within(await section('Due now')).getByText('12:30')).toBeTruthy();
  });

  it('moves a stage from next to now as the clock passes it', async () => {
    await startFollowing();
    expect(within(await section('Next')).getByText('Carve')).toBeTruthy();
    act(() => { vi.setSystemTime(new Date('2026-12-06T13:21:00.000Z')); vi.advanceTimersByTime(60_000); });
    expect(within(await section('Due now')).getByText('Carve')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Next' })).toBeNull();
  });

  it('ticks a stage and sends it to the server', async () => {
    const user = await startFollowing();
    await user.click(await screen.findByRole('checkbox', { name: 'Done: Make the gravy' }));
    await waitFor(() => expect(vi.mocked(updateMeal)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateMeal)).toHaveBeenCalledWith('m1', { stages: expect.arrayContaining([expect.objectContaining({ text: 'Make the gravy', doneAt: '2026-12-06T12:45:00.000Z' })]) });
    expect(vi.mocked(updateMeal).mock.calls[0][1].stages).toHaveLength(3);
  });

  it('unticks a stage', async () => {
    const user = await startFollowing();
    await user.click(await screen.findByRole('checkbox', { name: 'Done: Brine the chicken' }));
    await waitFor(() => expect(vi.mocked(updateMeal)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateMeal)).toHaveBeenCalledWith('m1', { stages: expect.arrayContaining([expect.objectContaining({ text: 'Brine the chicken', doneAt: null })]) });
  });

  it('offers to keep the screen on while cooking', async () => {
    const user = await startFollowing();
    const toggle = (await screen.findByRole('checkbox', { name: 'Keep screen on' })) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    await user.click(toggle);
    expect(toggle.checked).toBe(true);
    await waitFor(() => expect(navigator.wakeLock.request).toHaveBeenCalledTimes(1));
  });

  it('never calls the AI from the live view', async () => {
    const user = await startFollowing();
    await user.click(await screen.findByRole('checkbox', { name: 'Done: Make the gravy' }));
    await waitFor(() => expect(vi.mocked(updateMeal)).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Draft/ })).toBeNull();
    expect(vi.mocked(scheduleMeal)).not.toHaveBeenCalled();
  });

  it('says the meal is served when every stage is done', async () => {
    const done = threeStages().map((s) => ({ ...(s as object), doneAt: '2026-12-06T13:00:00.000Z' }));
    vi.mocked(getMeal).mockResolvedValue(meal(done));
    await startFollowing();
    expect(await screen.findByText('Everything is done. The meal is served.')).toBeTruthy();
  });

  it('shows a stage with no recipe and leaves out an empty section', async () => {
    await startFollowing();
    const next = await section('Next');
    expect(within(next).queryByRole('link')).toBeNull();
    expect(within(next).getByText('13:20')).toBeTruthy();
    expect(screen.queryByText(/Everything is done/)).toBeNull();
  });

  it('can return to the plan', async () => {
    const user = await startFollowing();
    await user.click(await screen.findByRole('button', { name: 'Back to the plan' }));
    expect(await screen.findByRole('region', { name: 'Schedule' })).toBeTruthy();
  });
});
