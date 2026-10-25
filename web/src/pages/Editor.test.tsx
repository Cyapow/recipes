// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import type { Recipe } from '../api';

vi.mock('../api', () => ({ getRecipe: vi.fn(), saveRecipe: vi.fn(), deleteRecipe: vi.fn() }));
import { getRecipe, saveRecipe } from '../api';

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(getRecipe).mockReset();
  vi.mocked(saveRecipe).mockReset();
});

const rec = (id: string, title: string): Recipe => ({
  id, title, createdAt: '', updatedAt: '', description: null, origin: 'mine', sourceName: null,
  sourceUrl: null, servings: null, prepMinutes: null, cookMinutes: null, ingredients: [],
  steps: [], notes: null, tags: [], imageIds: [],
});

function app(start: string) {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Link to="/recipe/b/edit">to-b</Link>
      <Routes>
        <Route path="/new" element={<Editor />} />
        <Route path="/recipe/:id/edit" element={<Editor />} />
        <Route path="/recipe/:id" element={<p>cook page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Editor', () => {
  it('shows the new recipe after navigating between edit URLs', async () => {
    vi.mocked(getRecipe).mockImplementation(async (id) => rec(id, id === 'a' ? 'Alpha' : 'Beta'));
    const user = userEvent.setup();
    app('/recipe/a/edit');
    expect(((await screen.findByLabelText('Title')) as HTMLInputElement).value).toBe('Alpha');
    await user.click(screen.getByText('to-b'));
    await waitFor(() => expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Beta'));
  });

  it('ignores a stale response for a after b loaded', async () => {
    let resolveA!: (r: Recipe) => void;
    vi.mocked(getRecipe).mockImplementation((id) =>
      id === 'a' ? new Promise<Recipe>((r) => (resolveA = r)) : Promise.resolve(rec('b', 'Beta')),
    );
    const user = userEvent.setup();
    app('/recipe/a/edit');
    await user.click(screen.getByText('to-b'));
    await waitFor(() => expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Beta'));
    await act(async () => resolveA(rec('a', 'Alpha')));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Beta');
  });

  it('saves once on a double click', async () => {
    let resolve!: (r: Recipe) => void;
    vi.mocked(saveRecipe).mockImplementation(() => new Promise<Recipe>((r) => (resolve = r)));
    const user = userEvent.setup();
    app('/new');
    await user.type(screen.getByLabelText('Title'), 'Soup');
    const btn = screen.getByRole('button', { name: 'Save' });
    await user.dblClick(btn);
    expect(saveRecipe).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();
    await act(async () => resolve(rec('n', 'Soup')));
    expect(await screen.findByText('cook page')).toBeTruthy();
  });

  it('shows a specific message for a 400 with step issues and keeps the edits; generic otherwise', async () => {
    const mk = (status: number, body?: unknown) => Object.assign(new Error('x'), { name: 'ApiError', status, body });
    const user = userEvent.setup();
    app('/new');
    await user.type(screen.getByLabelText('Title'), 'Soup');
    vi.mocked(saveRecipe).mockRejectedValueOnce(mk(400, { issues: [{ path: ['steps', 1, 'text'], message: 'Step text looks corrupted ([object Object])' }] }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe("Step 2 can't be saved: Step text looks corrupted ([object Object])");
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Soup');
    vi.mocked(saveRecipe).mockRejectedValueOnce(mk(400, { error: 'Invalid' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not save recipe'));
    vi.mocked(saveRecipe).mockRejectedValueOnce(mk(500));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveRecipe).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('alert').textContent).toBe('Could not save recipe');
  });
});
