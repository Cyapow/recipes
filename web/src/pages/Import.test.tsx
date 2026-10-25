// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Import } from './Import';
import type { ImportResult } from '../api';

vi.mock('../api', async () => ({ ...(await vi.importActual<typeof import('../api')>('../api')), importRecipe: vi.fn(), saveRecipe: vi.fn(), uploadImage: vi.fn() }));
import { ApiError, importRecipe, saveRecipe } from '../api';

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(importRecipe).mockReset();
  vi.mocked(saveRecipe).mockReset();
});

const draft: ImportResult['draft'] = {
  title: 'Easy pancakes', description: null, origin: 'other', sourceName: 'bbcgoodfood.com', sourceUrl: 'https://www.bbcgoodfood.com/r',
  servings: 4, prepMinutes: 10, cookMinutes: 20,
  ingredients: [{ group: null, quantity: null, unit: null, item: '100g plain flour', note: null }],
  steps: ['Whisk'], notes: null, tags: [], imageIds: [], gaps: [],
};

function app() {
  return render(
    <MemoryRouter initialEntries={['/import']}>
      <Routes>
        <Route path="/import" element={<Import />} />
        <Route path="/recipe/:id" element={<p>cook page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Import', () => {
  it('imports into the form and saves only on Save', async () => {
    vi.mocked(importRecipe).mockResolvedValue({ draft, usedAi: false, usable: true });
    vi.mocked(saveRecipe).mockResolvedValue({ ...draft, id: 'n1', createdAt: '', updatedAt: '' });
    const user = userEvent.setup();
    app();
    const input = screen.getByLabelText(/recipe page address/i);
    expect(input.getAttribute('type')).toBe('url');
    expect(input.getAttribute('inputmode')).toBe('url');
    await user.type(input, 'https://www.bbcgoodfood.com/r');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByDisplayValue('Easy pancakes')).toBeTruthy();
    expect(importRecipe).toHaveBeenCalledWith('https://www.bbcgoodfood.com/r');
    expect(screen.queryByText(/couldn't find a recipe/i)).toBeNull();
    expect(saveRecipe).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(screen.getByText('cook page')).toBeTruthy());
    expect(saveRecipe).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveRecipe).mock.calls[0]![1]).toMatchObject({ title: 'Easy pancakes', origin: 'other', sourceUrl: 'https://www.bbcgoodfood.com/r' });
  });

  it('shows a message above the usable empty editor when no recipe was found', async () => {
    vi.mocked(importRecipe).mockResolvedValue({
      draft: { ...draft, title: 'nan.example', ingredients: [], steps: [], servings: null, prepMinutes: null, cookMinutes: null, sourceUrl: 'https://nan.example/x', sourceName: 'nan.example' },
      usedAi: false,
      usable: false,
    });
    const user = userEvent.setup();
    app();
    await user.type(screen.getByLabelText(/recipe page address/i), 'https://nan.example/x');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText("Couldn't find a recipe on that page")).toBeTruthy();
    expect(screen.getAllByDisplayValue('https://nan.example/x')).toHaveLength(2); // address box + source field
  });

  it('opens a prefilled empty editor when the page could not be fetched (502)', async () => {
    vi.mocked(importRecipe).mockRejectedValue(new ApiError("Couldn't fetch that page", 502));
    vi.mocked(saveRecipe).mockResolvedValue({ ...draft, id: 'n2', createdAt: '', updatedAt: '' });
    const user = userEvent.setup();
    app();
    await user.type(screen.getByLabelText(/recipe page address/i), 'https://www.blocked.example/r/1');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't fetch that page/);
    expect(screen.getAllByDisplayValue('blocked.example')).toHaveLength(2); // title + source name
    expect(screen.getAllByDisplayValue('https://www.blocked.example/r/1')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(screen.getByText('cook page')).toBeTruthy());
    expect(vi.mocked(saveRecipe).mock.calls[0]![1]).toMatchObject({
      title: 'blocked.example', origin: 'other', sourceName: 'blocked.example', sourceUrl: 'https://www.blocked.example/r/1', ingredients: [], steps: [],
    });
  });

  it('shows only the error, no form, for a blocked URL (400)', async () => {
    vi.mocked(importRecipe).mockRejectedValue(new ApiError("That URL can't be fetched", 400));
    const user = userEvent.setup();
    app();
    await user.type(screen.getByLabelText(/recipe page address/i), 'http://10.0.0.1');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect((await screen.findByRole('alert')).textContent).toBe("That URL can't be fetched");
    expect(screen.queryByRole('button', { name: /^save/i })).toBeNull();
  });

  it('shows the server error and no form on failure', async () => {
    vi.mocked(importRecipe).mockRejectedValue(new Error("That URL can't be fetched"));
    const user = userEvent.setup();
    app();
    await user.type(screen.getByLabelText(/recipe page address/i), 'http://10.0.0.1');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect((await screen.findByRole('alert')).textContent).toBe("That URL can't be fetched");
    expect(screen.queryByRole('button', { name: /^save/i })).toBeNull();
  });

  it('ignores a second Import click while one is in flight', async () => {
    let resolve!: (v: ImportResult) => void;
    vi.mocked(importRecipe).mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    app();
    await user.type(screen.getByLabelText(/recipe page address/i), 'https://a.test/');
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect((screen.getByRole('button', { name: /importing/i }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard('{Enter}');
    expect(importRecipe).toHaveBeenCalledTimes(1);
    resolve({ draft, usedAi: false, usable: true });
    await screen.findByDisplayValue('Easy pancakes');
  });
});
