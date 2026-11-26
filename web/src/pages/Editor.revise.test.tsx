// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Editor } from './Editor';
import { listDrafts } from '../lib/drafts';
import type { Recipe, Revision } from '../api';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  getRecipe: vi.fn(), saveRecipe: vi.fn(), deleteRecipe: vi.fn(), getFacets: vi.fn(), reviseRecipe: vi.fn(),
}));
import { ApiError, getFacets, getRecipe, reviseRecipe, saveRecipe } from '../api';

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  vi.mocked(getRecipe).mockReset().mockResolvedValue(rec());
  vi.mocked(saveRecipe).mockReset().mockResolvedValue({ id: 'r1' } as never);
  vi.mocked(reviseRecipe).mockReset();
  vi.mocked(getFacets).mockReset().mockResolvedValue({ brands: [], tags: [], people: [] });
});

const wine = { about: 'red wine', question: 'How much red wine did you add?' };
const oven = { about: 'oven', question: 'What temperature is the oven?' };
const step = (text: string) => ({ text, imageId: null, ingredients: [] as number[] });
const rec = (): Recipe => ({
  id: 'r1', title: 'Fudge', favouritedBy: [], createdAt: '', updatedAt: '', description: null, origin: 'mine', brand: 'Mine',
  sourceName: null, sourceUrl: null, servings: null, prepMinutes: null, cookMinutes: null, ingredients: [],
  steps: [step('Boil the sugar'), step('Pour it out')], notes: null, tags: [], imageIds: [],
});
const revised = (extra: Partial<Revision> = {}): Revision => {
  const { id: _i, createdAt: _c, updatedAt: _u, favouritedBy: _f, ...base } = rec();
  return { ...base, steps: [step('Boil the sugar'), step('Leave it to cool for 20 minutes'), step('Pour it out')], gaps: [], stepsFrom: [0, null, 1], ...extra };
};

function app() {
  return render(
    <MemoryRouter initialEntries={['/recipe/r1/edit']}>
      <Routes>
        <Route path="/recipe/:id/edit" element={<Editor />} />
        <Route path="/recipe/:id" element={<p>saved page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
async function apply(user: ReturnType<typeof userEvent.setup>, text: string) {
  const box = await screen.findByLabelText('Tell me what to change');
  await user.clear(box);
  await user.type(box, text);
  await user.click(screen.getByRole('button', { name: 'Revise' }));
}

describe('Editor revise', () => {
  it('sends what is on screen, not what was loaded', async () => {
    vi.mocked(reviseRecipe).mockResolvedValue(revised());
    const user = userEvent.setup();
    app();
    const title = await screen.findByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'typed title');
    await apply(user, 'cool it');
    expect(vi.mocked(reviseRecipe)).toHaveBeenCalledWith(expect.objectContaining({ title: 'typed title' }), 'cool it');
    // The form was touched by the typing, so its unmount flush would overwrite a draft written too early.
    await waitFor(() => expect(listDrafts()[0]?.input?.steps).toHaveLength(3));
  });

  it('asks for a title before revising a recipe that has none', async () => {
    const user = userEvent.setup();
    const view = render(
      <MemoryRouter initialEntries={['/new']}>
        <Routes><Route path="/new" element={<Editor />} /></Routes>
      </MemoryRouter>,
    );
    await apply(user, 'cool it');
    expect((await screen.findByRole('alert')).textContent).toMatch(/title first/);
    expect(vi.mocked(reviseRecipe)).not.toHaveBeenCalled();
    view.unmount();
  });

  it('replaces the form with the revision and marks the new step', async () => {
    vi.mocked(reviseRecipe).mockResolvedValue(revised());
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    expect(await screen.findByRole('textbox', { name: 'Step 2 New' })).toBeTruthy();
    expect(screen.getByText('Step 2 added')).toBeTruthy();
  });

  it('keeps the revision through a refresh by writing it to the device draft', async () => {
    vi.mocked(reviseRecipe).mockResolvedValue(revised());
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    await screen.findByRole('textbox', { name: 'Step 2 New' });
    await waitFor(() => expect(listDrafts()[0]?.input?.steps.map((s) => s.text)).toEqual(['Boil the sugar', 'Leave it to cool for 20 minutes', 'Pour it out']));
    expect(listDrafts()[0]?.kind).toBe('edit');
  });

  it('undo puts back what was there and clears the marks and the summary', async () => {
    vi.mocked(reviseRecipe).mockResolvedValue(revised());
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    await screen.findByText('Step 2 added');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByRole('textbox', { name: /New/ })).toBeNull();
    expect(screen.queryByText('Step 2 added')).toBeNull();
    expect((screen.getByLabelText('Step 2') as HTMLTextAreaElement).value).toBe('Pour it out');
    await waitFor(() => expect(listDrafts()[0]?.input?.steps).toHaveLength(2));
  });

  it('undo puts back what was typed while the AI was working, not what was sent', async () => {
    let release!: (r: Revision) => void;
    vi.mocked(reviseRecipe).mockImplementation(() => new Promise<Revision>((r) => (release = r)));
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    // The form stays live while the call is out, so this typing is on screen when the revision lands.
    const title = await screen.findByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'typed while waiting');
    await act(async () => release(revised()));
    await screen.findByRole('textbox', { name: 'Step 2 New' });
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Fudge');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('typed while waiting');
  });

  it('undo puts back the "Check these" list the revision replaced', async () => {
    vi.mocked(reviseRecipe)
      .mockResolvedValueOnce(revised({ gaps: [{ about: 'How long does it set for?', question: null }] }))
      .mockResolvedValueOnce(revised({ gaps: [{ about: 'How much sugar?', question: null }] }));
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    expect(await screen.findByText('How long does it set for?')).toBeTruthy();
    await apply(user, 'and again');
    expect(await screen.findByText('How much sugar?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('How long does it set for?')).toBeTruthy();
    expect(screen.queryByText('How much sugar?')).toBeNull();
  });

  it('a second instruction revises the result of the first', async () => {
    vi.mocked(reviseRecipe).mockResolvedValueOnce(revised()).mockResolvedValueOnce(revised());
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    await screen.findByText('Step 2 added');
    await apply(user, 'again');
    await waitFor(() => expect(vi.mocked(reviseRecipe)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(reviseRecipe).mock.calls[1]![0]).toMatchObject({ steps: expect.arrayContaining([expect.objectContaining({ text: 'Leave it to cool for 20 minutes' })]) });
  });

  it('shows the gaps from a revision in Check these', async () => {
    vi.mocked(reviseRecipe).mockResolvedValue(revised({ gaps: [{ about: 'How long does it set for?', question: null }] }));
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    expect(await screen.findByText('How long does it set for?')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Check these' })).toBeTruthy();
  });

  it('replaces the gap list on a free-text revise', async () => {
    vi.mocked(reviseRecipe)
      .mockResolvedValueOnce(revised({ gaps: [wine, oven] }))
      .mockResolvedValueOnce(revised({ gaps: [oven] }));
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    expect(await screen.findByLabelText(wine.question)).toBeTruthy();
    await apply(user, 'and some wine');
    await waitFor(() => expect(screen.queryByLabelText(wine.question)).toBeNull());
    expect(screen.getByLabelText(oven.question)).toBeTruthy();
  });

  it('merges the gap list when answering', async () => {
    vi.mocked(reviseRecipe)
      .mockResolvedValueOnce(revised({ gaps: [wine, oven] }))
      .mockResolvedValueOnce(revised({ gaps: [] }));
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    await user.type(await screen.findByLabelText(wine.question), 'about 150ml');
    await user.click(screen.getByRole('button', { name: 'Answer 1 question' }));
    await waitFor(() => expect(screen.queryByLabelText(wine.question)).toBeNull());
    // Only the question that was answered leaves the list.
    expect(screen.getByLabelText(oven.question)).toBeTruthy();
    expect(vi.mocked(reviseRecipe).mock.calls[1]![1]).toContain('Q: How much red wine did you add? A: about 150ml');
  });

  it('answering keeps the step marks, the summary and Undo', async () => {
    vi.mocked(reviseRecipe)
      .mockResolvedValueOnce(revised({ gaps: [wine], steps: [step('Boil the sugar'), step('Pour it out')], stepsFrom: [0, 1] }))
      .mockResolvedValueOnce(revised({ gaps: [] }));
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    await user.type(await screen.findByLabelText(wine.question), 'about 150ml');
    await user.click(screen.getByRole('button', { name: 'Answer 1 question' }));
    expect(await screen.findByRole('textbox', { name: 'Step 2 New' })).toBeTruthy();
    expect(screen.getByText('Step 2 added')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByText('Step 2 added')).toBeNull();
    expect(await screen.findByLabelText(wine.question)).toBeTruthy();
  });

  it('shows the error in the panel and keeps the typed answer when answering fails', async () => {
    const msg = 'The AI is busy. Try again in a minute.';
    vi.mocked(reviseRecipe)
      .mockResolvedValueOnce(revised({ gaps: [wine] }))
      .mockRejectedValueOnce(new ApiError(msg, 502, { error: msg, code: 'unavailable' }));
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    await user.type(await screen.findByLabelText(wine.question), 'about 150ml');
    await user.click(screen.getByRole('button', { name: 'Answer 1 question' }));
    const panel = screen.getByRole('region', { name: 'Check these' });
    await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(msg));
    expect((screen.getByLabelText(wine.question) as HTMLInputElement).value).toBe('about 150ml');
  });

  it('drops the answer error when the revision it was waiting for lands', async () => {
    let settle!: (r: Revision) => void;
    vi.mocked(reviseRecipe)
      .mockResolvedValueOnce(revised({ gaps: [wine] }))
      .mockImplementationOnce(() => new Promise<Revision>((r) => { settle = r; }));
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    await user.type(await screen.findByLabelText(wine.question), 'about 150ml');
    // A typed revision is in flight, so the answer is refused and the panel says to wait for it.
    await apply(user, 'and again');
    await user.click(screen.getByRole('button', { name: 'Answer 1 question' }));
    const panel = () => screen.getByRole('region', { name: 'Check these' });
    await waitFor(() => expect(within(panel()).getByRole('alert').textContent).toMatch(/Wait for the revision/));
    // It has now finished, so the message has nothing left to say and must not sit under a live panel.
    await act(async () => { settle(revised({ gaps: [wine] })); });
    await waitFor(() => expect(within(panel()).queryByRole('alert')).toBeNull());
  });

  it('does not say Answering… while a typed instruction is in flight, and refuses an answer then', async () => {
    vi.mocked(reviseRecipe)
      .mockResolvedValueOnce(revised({ gaps: [wine] }))
      .mockImplementationOnce(() => new Promise<Revision>(() => {}));
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    await user.type(await screen.findByLabelText(wine.question), 'about 150ml');
    await apply(user, 'and again');
    // No answers went out, so the panel's button still reads as itself rather than "Answering…".
    await user.click(screen.getByRole('button', { name: 'Answer 1 question' }));
    expect(vi.mocked(reviseRecipe)).toHaveBeenCalledTimes(2);
    const panel = screen.getByRole('region', { name: 'Check these' });
    await waitFor(() => expect(within(panel).getByRole('alert').textContent).toMatch(/Wait for the revision/));
    expect((screen.getByLabelText(wine.question) as HTMLInputElement).value).toBe('about 150ml');
  });

  it('asks for a title before answering a recipe that has none', async () => {
    vi.mocked(reviseRecipe).mockResolvedValueOnce(revised({ gaps: [wine] }));
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    await user.type(await screen.findByLabelText(wine.question), 'about 150ml');
    await user.clear(screen.getByLabelText('Title'));
    await user.click(screen.getByRole('button', { name: 'Answer 1 question' }));
    const panel = screen.getByRole('region', { name: 'Check these' });
    await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe('Give the recipe a title first, then answer the questions.'));
    expect(vi.mocked(reviseRecipe)).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(wine.question) as HTMLInputElement).value).toBe('about 150ml');
  });

  it('says so when the server has no AI configured', async () => {
    vi.mocked(reviseRecipe).mockRejectedValue(new Error('AI not configured'));
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    expect((await screen.findByRole('alert')).textContent).toMatch(/AI is not configured/);
  });

  it('saves the revision when Save is pressed, and nothing before that', async () => {
    vi.mocked(reviseRecipe).mockResolvedValue(revised());
    const user = userEvent.setup();
    app();
    await apply(user, 'cool it');
    await screen.findByText('Step 2 added');
    expect(vi.mocked(saveRecipe)).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('saved page');
    expect(vi.mocked(saveRecipe).mock.calls[0]![1].steps.map((s) => s.text)).toEqual(['Boil the sugar', 'Leave it to cool for 20 minutes', 'Pour it out']);
  });
});
