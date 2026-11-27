// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { RecipeCourses } from './RecipeCourses';
import type { Course } from '../../../server/src/meals/courses';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  listRecipes: vi.fn(),
  getFacets: vi.fn(),
}));
import { getFacets, listRecipes } from '../api';

const recipe = (id: string, title: string, extra: Record<string, unknown> = {}) =>
  ({ id, title, origin: 'mine', brand: 'Mine', sourceName: null, tags: [], thumbnailId: null, totalMinutes: null, favouritedBy: [], ...extra }) as never;

/** The real callers hold the picked recipes, so the test does too: ticking must survive a changed search. */
function Harness({ atLimit = false }: { atLimit?: boolean } = {}) {
  const [courses, setCourses] = useState<Record<string, Course>>({});
  return (
    <RecipeCourses
      courses={courses}
      atLimit={atLimit}
      onToggle={(id) =>
        setCourses((c) => (id in c ? Object.fromEntries(Object.entries(c).filter(([k]) => k !== id)) : { ...c, [id]: 'main' }))
      }
      onCourse={(id, course) => setCourses((c) => ({ ...c, [id]: course }))}
    />
  );
}

beforeEach(() => {
  vi.mocked(listRecipes).mockReset().mockResolvedValue([recipe('r1', 'Roast chicken'), recipe('r2', 'Gravy')]);
  vi.mocked(getFacets).mockReset().mockResolvedValue({
    brands: [], tags: [{ group: 'meal', name: 'Dinner', count: 2 }], people: [],
  });
});
afterEach(cleanup);

describe('RecipeCourses', () => {
  it('asks the server for the search text, so a search matches ingredients as it does in the library', async () => {
    render(<Harness />);
    await screen.findByLabelText('Roast chicken');

    vi.mocked(listRecipes).mockResolvedValue([recipe('r3', 'Spaghetti Bolognese')]);
    await userEvent.type(screen.getByLabelText('Search recipes'), 'mince');

    expect(await screen.findByLabelText('Spaghetti Bolognese')).toBeTruthy();
    await waitFor(() => expect(vi.mocked(listRecipes).mock.calls.at(-1)?.[0]).toEqual({ search: 'mince' }));
  });

  it('keeps a picked recipe on screen when the search stops matching it', async () => {
    render(<Harness />);
    await userEvent.click(await screen.findByLabelText('Roast chicken'));

    vi.mocked(listRecipes).mockResolvedValue([recipe('r2', 'Gravy')]);
    await userEvent.type(screen.getByLabelText('Search recipes'), 'gravy');
    await screen.findByText('Already picked');

    // Still ticked, still there to untick: a search narrows what you browse, never what you have chosen.
    const chicken = screen.getByLabelText('Roast chicken') as HTMLInputElement;
    expect(chicken.checked).toBe(true);
    expect(screen.getByLabelText('Gravy')).toBeTruthy();
  });

  it('does not pin a picked recipe the search already shows', async () => {
    render(<Harness />);
    await userEvent.click(await screen.findByLabelText('Roast chicken'));

    expect(screen.queryByText('Already picked')).toBeNull();
    expect(screen.getAllByLabelText('Roast chicken')).toHaveLength(1);
  });

  it('tells the two empty lists apart', async () => {
    vi.mocked(listRecipes).mockResolvedValue([]);
    render(<Harness />);
    expect(await screen.findByText('No recipes yet.')).toBeTruthy();

    await userEvent.type(screen.getByLabelText('Search recipes'), 'z');
    expect(await screen.findByText('No recipes match that.')).toBeTruthy();
  });

  it('says so when the recipes could not be loaded', async () => {
    vi.mocked(listRecipes).mockRejectedValue(new Error('nope'));
    render(<Harness />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Could not load recipes');
  });

  it('pins a picked recipe a filter hides, as it does for a search', async () => {
    render(<Harness />);
    await userEvent.click(await screen.findByLabelText('Roast chicken'));

    vi.mocked(listRecipes).mockResolvedValue([recipe('r2', 'Gravy')]);
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dinner' }));
    await screen.findByText('Already picked');

    const chicken = screen.getByLabelText('Roast chicken') as HTMLInputElement;
    expect(chicken.checked).toBe(true);
  });

  it('does not create the meal when the filters are opened', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(<form onSubmit={onSubmit}><Harness /></form>);
    await screen.findByLabelText('Roast chicken');

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Dinner' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows what a recipe is, not only its title', async () => {
    vi.mocked(listRecipes).mockResolvedValue([
      recipe('r1', 'Roast chicken', { tags: [{ group: 'meal', name: 'Dinner' }], totalMinutes: 95 }),
    ]);
    render(<Harness />);

    expect(await screen.findByText('Mine · Dinner · 1h 35m')).toBeTruthy();
    // The tick is still named after the recipe alone, so "tick Roast chicken" keeps meaning one thing.
    expect(screen.getByLabelText('Roast chicken')).toBeTruthy();
  });
});
