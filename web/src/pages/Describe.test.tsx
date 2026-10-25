// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Describe } from './Describe';
import type { RecipeDraft } from '../api';

vi.mock('../api', () => ({ describeRecipe: vi.fn(), saveRecipe: vi.fn(), uploadImage: vi.fn() }));
import { describeRecipe, saveRecipe } from '../api';

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(describeRecipe).mockReset();
  vi.mocked(saveRecipe).mockReset();
});

const draft: RecipeDraft = {
  title: 'Spag bol', description: null, origin: 'mine', sourceName: null, sourceUrl: null,
  servings: null, prepMinutes: null, cookMinutes: null,
  ingredients: [{ group: null, quantity: null, unit: null, item: 'red wine', note: null }],
  steps: ['Brown the mince'], notes: null, tags: [], imageIds: [], gaps: ['quantity for red wine'],
};

function app() {
  return render(
    <MemoryRouter initialEntries={['/describe']}>
      <Routes>
        <Route path="/describe" element={<Describe />} />
        <Route path="/recipe/:id" element={<p>cook page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Describe', () => {
  it('shows gaps and does not save until Save is pressed', async () => {
    vi.mocked(describeRecipe).mockResolvedValue(draft);
    vi.mocked(saveRecipe).mockResolvedValue({ ...draft, id: 'n1', createdAt: '', updatedAt: '' });
    const user = userEvent.setup();
    app();
    await user.type(screen.getByRole('textbox'), 'my spag bol with red wine');
    await user.click(screen.getByRole('button', { name: /create draft/i }));
    expect(await screen.findByText('quantity for red wine')).toBeTruthy();
    expect(describeRecipe).toHaveBeenCalledWith('my spag bol with red wine');
    expect(saveRecipe).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^save/i }));
    await screen.findByText('cook page');
    expect(saveRecipe).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveRecipe).mock.calls[0]![0]).toBeNull();
    expect(vi.mocked(saveRecipe).mock.calls[0]![1]).not.toHaveProperty('gaps');
  });

  it('ignores a second Save while one is in flight', async () => {
    vi.mocked(describeRecipe).mockResolvedValue(draft);
    vi.mocked(saveRecipe).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    app();
    await user.type(screen.getByRole('textbox'), 'x');
    await user.click(screen.getByRole('button', { name: /create draft/i }));
    const save = await screen.findByRole('button', { name: /^save/i });
    await user.click(save);
    await user.click(save);
    expect(saveRecipe).toHaveBeenCalledTimes(1);
  });

  it('guards against double-submitting Create draft', async () => {
    vi.mocked(describeRecipe).mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    app();
    await user.type(screen.getByRole('textbox'), 'x');
    const btn = screen.getByRole('button', { name: /create draft/i });
    await user.click(btn);
    await user.click(btn);
    expect(describeRecipe).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: /creating/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a clear message when AI is not configured', async () => {
    vi.mocked(describeRecipe).mockRejectedValue(new Error('AI not configured'));
    const user = userEvent.setup();
    app();
    await user.type(screen.getByRole('textbox'), 'x');
    await user.click(screen.getByRole('button', { name: /create draft/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not configured/i));
    expect(screen.queryByRole('button', { name: /^save/i })).toBeNull();
  });
});
