// @vitest-environment jsdom
process.env.TZ = 'Europe/London';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Meal } from './Meal';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  getMeal: vi.fn(), scheduleMeal: vi.fn(), updateMeal: vi.fn(),
}));
import { ApiError, getMeal, scheduleMeal, updateMeal } from '../api';

const stage = (over: object = {}) => ({
  id: 's1', recipeId: 'r1', offsetMinutes: 180, durationMinutes: 30, estimated: false, text: 'Brine the chicken',
  stepIndices: [0], doneAt: null, position: 0, at: '2026-12-05T18:30:00.000Z', dayGroup: 'the day before', ...over,
});
const meal = (over: object = {}) => ({
  id: 'm1', title: 'Sunday lunch', serveAt: '2026-12-06T13:30:00.000Z', watchOut: [], scheduleStale: false,
  scheduledAt: '2026-12-01T10:00:00.000Z', createdAt: '', updatedAt: '',
  recipes: [
    { id: 'mr1', recipeId: 'r1', recipeTitle: 'Roast chicken', course: 'main', position: 0 },
    { id: 'mr2', recipeId: 'r2', recipeTitle: 'Gravy', course: 'side', position: 1 },
  ],
  ingredients: [
    {
      key: 'onion', item: 'onion', unit: '', quantity: 3, text: '3 onions',
      uses: [
        { recipeTitle: 'Roast chicken', group: null, note: 'finely chopped', quantity: 2, unit: null, item: 'onion' },
        { recipeTitle: 'Gravy', group: 'for the sauce', note: null, quantity: 1, unit: null, item: 'onion' },
      ],
    },
  ],
  stages: [
    stage(),
    stage({ id: 's2', text: 'Make the gravy', recipeId: 'r2', offsetMinutes: 60, durationMinutes: 40, estimated: true, at: '2026-12-06T12:30:00.000Z', dayGroup: 'on the day', position: 1 }),
    stage({ id: 's3', text: 'Carve', recipeId: null, offsetMinutes: 10, durationMinutes: null, at: '2026-12-06T13:20:00.000Z', dayGroup: 'on the day', position: 2 }),
  ],
  ...over,
}) as never;

const view = () =>
  render(
    <MemoryRouter initialEntries={['/meals/m1']}>
      <Routes>
        <Route path="/meals/:id" element={<Meal />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.mocked(getMeal).mockReset().mockResolvedValue(meal());
  vi.mocked(scheduleMeal).mockReset().mockResolvedValue(meal());
  vi.mocked(updateMeal).mockReset().mockResolvedValue(meal());
});
afterEach(cleanup);

describe('Meal plan', () => {
  it('shows the merged ingredients with which recipes want each one', async () => {
    view();
    expect(await screen.findByText('3 onions')).toBeTruthy();
    expect(screen.getByText(/Roast chicken: finely chopped/)).toBeTruthy();
    expect(screen.getByText(/Gravy: for the sauce/)).toBeTruthy();
  });

  it('groups the stages by day, in the order the server gave them', async () => {
    view();
    await screen.findByText('Brine the chicken');
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings.filter((h) => h === 'the day before' || h === 'on the day')).toEqual(['the day before', 'on the day']);
  });

  it('shows a stage clock time, its duration, and its recipe', async () => {
    view();
    const row = (await screen.findByText('Brine the chicken')).closest('li')!;
    expect(row.textContent).toContain('18:30');
    expect(row.textContent).toContain('30 min');
    expect(within(row).getByRole('link', { name: 'Roast chicken' })).toBeTruthy();
  });

  it('marks an estimated stage as an estimate rather than a stated time', async () => {
    view();
    expect(await screen.findByText(/about 40 min/)).toBeTruthy();
    expect(screen.queryByText(/about 30 min/)).toBeNull();
  });

  it('shows the watch-out notes where a draft shows Check these', async () => {
    vi.mocked(getMeal).mockResolvedValue(meal({ watchOut: ['Both need the oven at different heats'] }));
    view();
    const box = await screen.findByRole('region', { name: 'Check these' });
    expect(box.className).toContain('gaps');
    expect(box.textContent).toContain('Both need the oven at different heats');
  });

  it('says the schedule has fallen behind the recipes when the meal is stale', async () => {
    vi.mocked(getMeal).mockResolvedValue(meal({ scheduleStale: true }));
    view();
    expect((await screen.findByRole('region', { name: 'Check these' })).textContent).toContain('fallen behind');
  });

  it('shows no Check these box when there is nothing to check', async () => {
    view();
    await screen.findByText('Brine the chicken');
    expect(screen.queryByRole('region', { name: 'Check these' })).toBeNull();
  });

  it('links a stage to its recipe, and shows no link when the recipe is gone', async () => {
    view();
    const linked = (await screen.findByText('Brine the chicken')).closest('li')!;
    expect(within(linked).getByRole('link').getAttribute('href')).toBe('/recipe/r1');
    const orphan = screen.getByText('Carve').closest('li')!;
    expect(orphan.querySelector('a')).toBeNull();
  });

  it('offers to draft a schedule when there are no stages', async () => {
    vi.mocked(getMeal).mockResolvedValue(meal({ stages: [] }));
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Draft a schedule' }));
    expect(vi.mocked(scheduleMeal)).toHaveBeenCalledWith('m1', false);
    expect(await screen.findByText('Brine the chicken')).toBeTruthy();
  });

  it('shows the sentence describeAiError gives when drafting fails', async () => {
    vi.mocked(getMeal).mockResolvedValue(meal({ stages: [] }));
    vi.mocked(scheduleMeal).mockRejectedValue(new Error('AI not configured'));
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Draft a schedule' }));
    expect((await screen.findByRole('alert')).textContent).toContain('AI is not configured');
  });

  it('asks before replacing an existing schedule and says what would go', async () => {
    vi.mocked(scheduleMeal)
      .mockRejectedValueOnce(new ApiError('conflict', 409, { code: 'has_stages', stages: 3, done: 2 }))
      .mockResolvedValueOnce(meal({ stages: [stage({ text: 'A fresh draft' })] }));
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Draft the schedule again' }));
    const ask = await screen.findByText(/replace 3 steps, 2 of them ticked off/);
    expect(ask).toBeTruthy();
    expect(vi.mocked(scheduleMeal)).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Replace the schedule' }));
    await waitFor(() => expect(vi.mocked(scheduleMeal)).toHaveBeenLastCalledWith('m1', true));
    expect(await screen.findByText('A fresh draft')).toBeTruthy();
  });

  it('hands the recipe set to the planner', async () => {
    view();
    const link = await screen.findByRole('link', { name: 'Plan the shopping' });
    expect(link.getAttribute('href')).toBe('/planner?recipe=r1&recipe=r2');
  });

  it('retimes a stage by hand and saves it', async () => {
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Change Brine the chicken' }));
    const minutes = screen.getByLabelText('Minutes before serving');
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '150');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(vi.mocked(updateMeal)).toHaveBeenCalledWith('m1', {
        stages: expect.arrayContaining([expect.objectContaining({ offsetMinutes: 150, text: 'Brine the chicken' })]),
      }),
    );
  });

  it('adds a stage of your own, and drops one', async () => {
    view();
    await userEvent.type(await screen.findByLabelText('New step'), 'Lay the table');
    await userEvent.clear(screen.getByLabelText('Minutes before serving (new step)'));
    await userEvent.type(screen.getByLabelText('Minutes before serving (new step)'), '45');
    await userEvent.click(screen.getByRole('button', { name: 'Add step' }));
    await waitFor(() =>
      expect(vi.mocked(updateMeal)).toHaveBeenCalledWith('m1', {
        stages: expect.arrayContaining([
          expect.objectContaining({ text: 'Lay the table', recipeId: null, stepIndices: [], offsetMinutes: 45 }),
        ]),
      }),
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Drop Carve' }));
    await waitFor(() => expect(vi.mocked(updateMeal)).toHaveBeenCalledTimes(2));
    const sent = vi.mocked(updateMeal).mock.calls[1]![1].stages!;
    expect(sent.map((s) => s.text)).toEqual(['Brine the chicken', 'Make the gravy']);
    expect(sent[0]).not.toHaveProperty('at');
  });
});
