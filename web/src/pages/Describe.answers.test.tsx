// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Describe } from './Describe';
import { listDrafts } from '../lib/drafts';
import type { Gap, RecipeDraft, Revision } from '../api';

vi.mock('../api', async () => ({
  ...(await vi.importActual<typeof import('../api')>('../api')),
  describeRecipe: vi.fn(), reviseRecipe: vi.fn(), saveRecipe: vi.fn(), uploadImage: vi.fn(),
}));
import { ApiError, describeRecipe, reviseRecipe } from '../api';

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  vi.mocked(describeRecipe).mockReset();
  vi.mocked(reviseRecipe).mockReset();
});

const wine = { about: 'red wine', question: 'How much red wine did you add?' };
const oven = { about: 'oven', question: 'What temperature is the oven?' };

const drafted: RecipeDraft = {
  title: 'Spag bol', description: null, origin: 'mine', brand: 'Mine', sourceName: null, sourceUrl: null,
  servings: null, prepMinutes: null, cookMinutes: null,
  ingredients: [{ group: null, quantity: null, unit: null, item: 'red wine', note: null }],
  steps: [{ text: 'Brown the mince', imageId: null, ingredients: [] }],
  notes: null, tags: [], imageIds: [], gaps: [wine, oven],
};

/** What /api/ai/revise sends back: the wine quantity filled in, and whichever questions are left. */
const revised = (gaps: Gap[]): Revision => {
  const { gaps: _g, ...input } = drafted;
  return {
    ...input,
    ingredients: [{ group: null, quantity: 150, unit: 'ml', item: 'red wine', note: null }],
    gaps,
    stepsFrom: [0],
  };
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

type User = ReturnType<typeof userEvent.setup>;

async function toDraft(user: User) {
  vi.mocked(describeRecipe).mockResolvedValue(drafted);
  await user.type(screen.getByRole('textbox'), 'my spag bol with a splash of red wine');
  await user.click(screen.getByRole('button', { name: /create draft/i }));
  await screen.findByLabelText(wine.question);
}

async function answerTheWine(user: User, answer = 'about 150ml') {
  await user.type(screen.getByLabelText(wine.question), answer);
  await user.click(screen.getByRole('button', { name: 'Answer 1 question' }));
}

describe('Describe answers', () => {
  it('sends the answered questions as one revise instruction', async () => {
    vi.mocked(reviseRecipe).mockResolvedValue(revised([]));
    const user = userEvent.setup();
    app();
    await toDraft(user);
    await answerTheWine(user);
    await waitFor(() => expect(reviseRecipe).toHaveBeenCalledTimes(1));
    expect(vi.mocked(reviseRecipe).mock.calls[0]![1]).toContain('Q: How much red wine did you add? A: about 150ml');
    expect(vi.mocked(reviseRecipe).mock.calls[0]![1]).not.toContain(oven.question);
    // The revision is what the form now holds.
    await waitFor(() => expect((screen.getByLabelText('Quantity for row 1') as HTMLInputElement).value).toBe('150'));
  });

  it('answers what is on screen, not the draft as it arrived', async () => {
    vi.mocked(reviseRecipe).mockResolvedValue(revised([]));
    const user = userEvent.setup();
    app();
    await toDraft(user);
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Mums spag bol');
    await answerTheWine(user);
    await waitFor(() => expect(reviseRecipe).toHaveBeenCalledTimes(1));
    expect(vi.mocked(reviseRecipe).mock.calls[0]![0]).toMatchObject({ title: 'Mums spag bol' });
  });

  it('keeps the question that was not answered', async () => {
    vi.mocked(reviseRecipe).mockResolvedValue(revised([]));
    const user = userEvent.setup();
    app();
    await toDraft(user);
    await answerTheWine(user);
    await waitFor(() => expect(screen.queryByLabelText(wine.question)).toBeNull());
    expect(screen.getByLabelText(oven.question)).toBeTruthy();
  });

  it('shows the error and keeps the typed answer when revise fails', async () => {
    const msg = 'The AI is busy. Try again in a minute.';
    vi.mocked(reviseRecipe).mockRejectedValue(new ApiError(msg, 502, { error: msg, code: 'unavailable' }));
    const user = userEvent.setup();
    app();
    await toDraft(user);
    await answerTheWine(user);
    const panel = screen.getByRole('region', { name: 'Check these' });
    await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(msg));
    expect((screen.getByLabelText(wine.question) as HTMLInputElement).value).toBe('about 150ml');
    expect(screen.getByLabelText(oven.question)).toBeTruthy();
  });

  it('writes the merged gaps to the device draft', async () => {
    vi.mocked(reviseRecipe).mockResolvedValue(revised([]));
    const user = userEvent.setup();
    app();
    await toDraft(user);
    await answerTheWine(user);
    await waitFor(() => expect(listDrafts()[0]?.gaps).toEqual([oven]));
    expect(listDrafts()[0]?.input?.ingredients[0]?.quantity).toBe(150);
    expect(listDrafts()[0]?.text).toBe('my spag bol with a splash of red wine');
  });

  it('keeps the edited form and the merged gaps when the old form flushes on unmount', async () => {
    vi.mocked(reviseRecipe).mockResolvedValue(revised([]));
    const user = userEvent.setup();
    app();
    await toDraft(user);
    // Touching the form arms its unmount flush, which would otherwise write the pre-answer contents last.
    const notes = screen.getByLabelText('Notes');
    await user.type(notes, 'from mum');
    await answerTheWine(user);
    await waitFor(() => expect(listDrafts()[0]?.input?.ingredients[0]?.quantity).toBe(150));
    expect(listDrafts()[0]?.gaps).toEqual([oven]);
  });
});
