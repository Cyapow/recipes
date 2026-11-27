// @vitest-environment jsdom
process.env.TZ = 'Europe/London';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Meal } from './Meal';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  getMeal: vi.fn(), scheduleMeal: vi.fn(), updateMeal: vi.fn(), deleteMeal: vi.fn(), listRecipes: vi.fn(), getFacets: vi.fn(),
}));
import { ApiError, deleteMeal, getFacets, getMeal, listRecipes, scheduleMeal, updateMeal } from '../api';
import { MAX_MEAL_RECIPES } from '../../../server/src/meals/limits';

const recipe = (id: string, title: string) => ({ id, title, origin: 'mine', sourceName: null, tags: [], thumbnailId: null, totalMinutes: null }) as never;

const stage = (over: object = {}) => ({
  id: 's1', recipeId: 'r1', offsetMinutes: 180, durationMinutes: 30, estimated: false, text: 'Brine the chicken',
  stepIndices: [0], doneAt: null, position: 0, at: '2026-12-05T18:30:00.000Z', clock: '18:30', dayGroup: 'the day before', ...over,
});
const meal = (over: object = {}) => ({
  id: 'm1', title: 'Sunday lunch', serveAt: '2026-12-06T13:30:00.000Z', serveText: 'Sunday 6 December 2026, 13:30', watchOut: [], scheduleStale: false,
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
    stage({ id: 's2', text: 'Make the gravy', recipeId: 'r2', offsetMinutes: 60, durationMinutes: 40, estimated: true, at: '2026-12-06T12:30:00.000Z', clock: '12:30', dayGroup: 'on the day', position: 1 }),
    stage({ id: 's3', text: 'Carve', recipeId: null, offsetMinutes: 10, durationMinutes: null, at: '2026-12-06T13:20:00.000Z', clock: '13:20', dayGroup: 'on the day', position: 2 }),
  ],
  ...over,
}) as never;

const view = () =>
  render(
    <MemoryRouter initialEntries={['/meals/m1']}>
      <Routes>
        <Route path="/meals/:id" element={<Meal />} />
        <Route path="/meals" element={<p>The meals list</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.mocked(getMeal).mockReset().mockResolvedValue(meal());
  vi.mocked(scheduleMeal).mockReset().mockResolvedValue(meal());
  vi.mocked(updateMeal).mockReset().mockResolvedValue(meal());
  vi.mocked(deleteMeal).mockReset().mockResolvedValue(undefined);
  vi.mocked(listRecipes).mockReset().mockResolvedValue([recipe('r1', 'Roast chicken'), recipe('r2', 'Gravy'), recipe('r3', 'Trifle')]);
  vi.mocked(getFacets).mockReset().mockResolvedValue({
    brands: [{ name: 'Hairy Bikers', count: 1 }], tags: [{ group: 'meal', name: 'Dinner', count: 2 }], people: [],
  });
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

  it('shows the server clock string under the server heading, not a time worked out in the browser', async () => {
    // 23:30Z is a different calendar day from the server's 'the day before' heading in some zones; the clock says what the server decided.
    vi.mocked(getMeal).mockResolvedValue(
      meal({ stages: [stage({ at: '2026-12-06T23:30:00.000Z', clock: '00:30', dayGroup: 'the day before', text: 'Chill overnight' })] }),
    );
    view();
    const row = (await screen.findByText('Chill overnight')).closest('li')!;
    expect(row.textContent).toContain('00:30');
    expect(row.textContent).not.toContain('23:30');
    expect(screen.getByRole('heading', { level: 3, name: 'the day before' })).toBeTruthy();
  });

  it('shows the server serving time rather than one formatted in the browser', async () => {
    // 23:30Z on 5 Dec reads as 23:30 in a London browser; the server string is what is shown.
    vi.mocked(getMeal).mockResolvedValue(meal({ serveAt: '2026-12-05T23:30:00.000Z', serveText: 'Sunday 6 December 2026, 00:30' }));
    view();
    expect((await screen.findByText(/Serving/)).textContent).toBe('Serving Sunday 6 December 2026, 00:30');
  });

  it('keeps what you typed for a new step when the save fails', async () => {
    vi.mocked(updateMeal).mockRejectedValue(new Error('down'));
    view();
    const input = await screen.findByLabelText('New step');
    await userEvent.type(input, 'Lay the table');
    await userEvent.click(screen.getByRole('button', { name: 'Add step' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not save your changes');
    expect((input as HTMLInputElement).value).toBe('Lay the table');
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

  it('says the schedule has fallen behind the recipes when the meal is stale, however it was made', async () => {
    vi.mocked(getMeal).mockResolvedValue(meal({ scheduleStale: true }));
    view();
    const box = await screen.findByRole('region', { name: 'Check these' });
    // A schedule written by hand goes stale the same way, so the note must not claim the AI drafted it.
    expect(within(box).getByRole('listitem').textContent).toBe(
      'The recipes have changed since this schedule was made, so it may have fallen behind them.',
    );
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
    const ask = await screen.findByRole('region', { name: 'Replace the schedule?' });
    expect(ask.textContent).toContain('replace 3 steps, 2 of them ticked off');
    // A question, not a failure: no error is shown and nothing is announced as an alert.
    expect(screen.queryByText(/Could not draft/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
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
    await userEvent.click(await screen.findByRole('button', { name: 'Drop the step' }));
    await waitFor(() => expect(vi.mocked(updateMeal)).toHaveBeenCalledTimes(2));
    const sent = vi.mocked(updateMeal).mock.calls[1]![1].stages!;
    expect(sent.map((s) => s.text)).toEqual(['Brine the chicken', 'Make the gravy']);
    expect(sent[0]).not.toHaveProperty('at');
  });

  it('asks before dropping a step of your own and leaves it alone if you say no', async () => {
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Drop Carve' }));
    const ask = await screen.findByRole('region', { name: 'Drop this step?' });
    expect(ask.textContent).toContain('Carve');
    expect(vi.mocked(updateMeal)).not.toHaveBeenCalled();
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep it' }));
    expect(vi.mocked(updateMeal)).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Drop Carve' })).toBeTruthy();
  });

  it('shows a ticked step as done in the plan, not only in the live view', async () => {
    vi.mocked(getMeal).mockResolvedValue(
      meal({ stages: [stage({ doneAt: '2026-12-05T18:45:00.000Z' }), stage({ id: 's2', text: 'Carve', doneAt: null })] }),
    );
    view();
    expect((await screen.findByText('Brine the chicken')).closest('li')!.className).toBe('meal-stage done');
    expect(screen.getByText('Carve').closest('li')!.className).toBe('meal-stage');
  });

  it('offers the hand-written step form when there is no schedule at all, so one can be built without the AI', async () => {
    vi.mocked(getMeal).mockResolvedValue(meal({ stages: [] }));
    view();
    await userEvent.type(await screen.findByLabelText('New step'), 'Peel the potatoes');
    await userEvent.clear(screen.getByLabelText('Minutes before serving (new step)'));
    await userEvent.type(screen.getByLabelText('Minutes before serving (new step)'), '90');
    await userEvent.click(screen.getByRole('button', { name: 'Add step' }));
    await waitFor(() => expect(vi.mocked(updateMeal)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateMeal).mock.calls[0]![1].stages).toEqual([
      { recipeId: null, offsetMinutes: 90, durationMinutes: null, estimated: false, text: 'Peel the potatoes', stepIndices: [], doneAt: null },
    ]);
  });

  it('changes the name, the serving time and the recipe set in one save', async () => {
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Change the meal' }));
    const name = await screen.findByLabelText('Name of the meal');
    expect((name as HTMLInputElement).value).toBe('Sunday lunch');
    // The field starts from the instant it was given, so saving it untouched saves the same instant back.
    expect((screen.getByLabelText('When do you want to eat?') as HTMLInputElement).value).toBe('2026-12-06T13:30');
    await userEvent.clear(name);
    await userEvent.type(name, 'Christmas lunch');
    fireEvent.change(screen.getByLabelText('When do you want to eat?'), { target: { value: '2026-12-06T15:00' } });
    await userEvent.click(await screen.findByLabelText('Trifle'));
    await userEvent.selectOptions(await screen.findByLabelText('Course for Trifle'), 'dessert');
    await userEvent.click(screen.getByRole('button', { name: 'Save the meal' }));
    await waitFor(() => expect(vi.mocked(updateMeal)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(updateMeal).mock.calls[0]![1]).toEqual({
      title: 'Christmas lunch',
      serveAt: '2026-12-06T15:00:00.000Z',
      recipes: [{ recipeId: 'r1', course: 'main' }, { recipeId: 'r2', course: 'side' }, { recipeId: 'r3', course: 'dessert' }],
    });
    // The form closes on a save that worked, and what the server sent back is what is on screen.
    await waitFor(() => expect(screen.queryByLabelText('Name of the meal')).toBeNull());
  });

  it('says the schedule has fallen behind the recipes once the recipe set has changed', async () => {
    vi.mocked(updateMeal).mockResolvedValue(meal({ scheduleStale: true }));
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Change the meal' }));
    await userEvent.click(await screen.findByLabelText('Trifle'));
    await userEvent.click(screen.getByRole('button', { name: 'Save the meal' }));
    expect((await screen.findByRole('region', { name: 'Check these' })).textContent).toContain('fallen behind');
  });

  it('shows the server\'s own sentence when a changed meal is refused', async () => {
    vi.mocked(updateMeal).mockRejectedValue(
      new ApiError('Request failed (400)', 400, { error: 'One of those recipes no longer exists' }),
    );
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Change the meal' }));
    await userEvent.click(await screen.findByLabelText('Trifle'));
    await userEvent.click(screen.getByRole('button', { name: 'Save the meal' }));
    expect((await screen.findByRole('alert')).textContent).toBe('One of those recipes no longer exists');
    // The form stays open on a failure, with the picks still in it, so the change is not lost.
    expect(screen.getByLabelText('Name of the meal')).toBeTruthy();
  });

  it('falls back to its own words when a failure carries no sentence', async () => {
    vi.mocked(updateMeal).mockRejectedValue(new Error('offline'));
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Change the meal' }));
    await userEvent.click(await screen.findByLabelText('Trifle'));
    await userEvent.click(screen.getByRole('button', { name: 'Save the meal' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save your changes');
  });

  it('stops short of the recipes a meal may hold, rather than letting the save be refused', async () => {
    const many = Array.from({ length: MAX_MEAL_RECIPES + 2 }, (_, i) => recipe(`x${i}`, `Dish ${i}`));
    vi.mocked(listRecipes).mockResolvedValue(many);
    vi.mocked(getMeal).mockResolvedValue(meal({ recipes: [], stages: [] }));
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Change the meal' }));
    await screen.findByLabelText('Dish 0');
    for (let i = 0; i < MAX_MEAL_RECIPES; i += 1) await userEvent.click(screen.getByLabelText(`Dish ${i}`));
    expect((screen.getByLabelText(`Dish ${MAX_MEAL_RECIPES}`) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Dish 0') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByText(`A meal holds ${MAX_MEAL_RECIPES} recipes at most. Untick one to pick another.`)).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Dish 0'));
    expect((screen.getByLabelText(`Dish ${MAX_MEAL_RECIPES}`) as HTMLInputElement).disabled).toBe(false);
  });

  it('will not save a meal with no recipes left in it', async () => {
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Change the meal' }));
    await userEvent.click(await screen.findByLabelText('Roast chicken'));
    await userEvent.click(screen.getByLabelText('Gravy'));
    expect((screen.getByRole('button', { name: 'Save the meal' }) as HTMLButtonElement).disabled).toBe(true);
    expect(vi.mocked(updateMeal)).not.toHaveBeenCalled();
  });

  it('asks before deleting the meal, then deletes it and goes back to the list', async () => {
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete this meal' }));
    const ask = await screen.findByRole('region', { name: 'Delete this meal?' });
    expect(ask.textContent).toContain('cannot be undone');
    expect(vi.mocked(deleteMeal)).not.toHaveBeenCalled();
    await userEvent.click(within(ask).getByRole('button', { name: 'Keep it' }));
    expect(vi.mocked(deleteMeal)).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete this meal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete the meal' }));
    await waitFor(() => expect(vi.mocked(deleteMeal)).toHaveBeenCalledWith('m1'));
    expect(await screen.findByText('The meals list')).toBeTruthy();
  });

  it('says so when the meal could not be deleted, and stays on the page', async () => {
    vi.mocked(deleteMeal).mockRejectedValue(new Error('down'));
    view();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete this meal' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete the meal' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not delete this meal');
    expect(screen.queryByText('The meals list')).toBeNull();
  });
});
