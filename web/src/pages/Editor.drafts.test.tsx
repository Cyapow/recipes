// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { Library } from './Library';
import { listDrafts, putDraft } from '../lib/drafts';

vi.mock('../api', () => ({
  getRecipe: vi.fn(), saveRecipe: vi.fn(), deleteRecipe: vi.fn(),
  listRecipes: vi.fn(), listTags: vi.fn(), getBackupStatus: vi.fn(),
}));
import { getBackupStatus, listRecipes, listTags, saveRecipe } from '../api';

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  vi.mocked(saveRecipe).mockReset().mockResolvedValue({ id: 'n1' } as never);
  vi.mocked(listRecipes).mockReset().mockResolvedValue([]);
  vi.mocked(listTags).mockReset().mockResolvedValue([]);
  vi.mocked(getBackupStatus).mockReset().mockResolvedValue({ banner: 'none' } as never);
});

const EMPTY = {
  title: '', description: null, origin: 'mine' as const, sourceName: null, sourceUrl: null, servings: null,
  prepMinutes: null, cookMinutes: null, ingredients: [], steps: [], notes: null, tags: [], imageIds: [],
};

const editor = (start: string) =>
  render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/new" element={<Editor />} />
        <Route path="/recipe/:id" element={<p>saved page</p>} />
        <Route path="/" element={<Library />} />
      </Routes>
    </MemoryRouter>,
  );

describe('drafts', () => {
  it('keeps what you typed, and a refresh (new mount with ?draft=) brings it back', async () => {
    const user = userEvent.setup();
    const first = editor('/new');
    await user.type(await screen.findByLabelText('Title'), 'Spag bol');
    await waitFor(() => expect(listDrafts()[0]?.input?.title).toBe('Spag bol'), { timeout: 2000 });
    const d = listDrafts()[0];
    first.unmount();
    cleanup();
    editor(`/new?draft=${d.id}`);
    expect(((await screen.findByLabelText('Title')) as HTMLInputElement).value).toBe('Spag bol');
  });

  it('makes no draft for a form nobody touched', async () => {
    const view = editor('/new');
    await screen.findByLabelText('Title');
    view.unmount();
    expect(listDrafts()).toEqual([]);
  });

  it('removes the draft once the recipe is saved', async () => {
    const user = userEvent.setup();
    editor('/new');
    await user.type(await screen.findByLabelText('Title'), 'Soup');
    await waitFor(() => expect(listDrafts()).toHaveLength(1), { timeout: 2000 });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('saved page');
    expect(listDrafts()).toEqual([]);
  });

  it('lists drafts in the library to resume or discard', async () => {
    putDraft({ id: 'x', kind: 'new', savedAt: Date.now(), input: { ...EMPTY, title: 'Half done stew' } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    editor('/');
    expect(await screen.findByText('Half done stew')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Half done stew/ }).getAttribute('href')).toBe('/new?draft=x');
    await user.click(screen.getByRole('button', { name: /Discard draft Half done stew/ }));
    expect(screen.queryByText('Half done stew')).toBeNull();
    expect(listDrafts()).toEqual([]);
  });
});
