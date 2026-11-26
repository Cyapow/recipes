// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GapsPanel } from './GapsPanel';
import { MAX_ANSWER_CHARS, MAX_ANSWERS } from '../lib/gaps';

const wine = { about: 'red wine', question: 'How much red wine did you add?' };
const oven = { about: 'oven', question: 'What temperature is the oven?' };
const ok = () => Promise.resolve();
const brand = { about: 'brand', question: null };

afterEach(cleanup);

describe('GapsPanel', () => {
  it('renders nothing when there are no gaps', () => {
    const { container } = render(<GapsPanel gaps={[]} onAnswer={ok} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a bullet and no box for a gap with no question', () => {
    render(<GapsPanel gaps={[brand]} onAnswer={ok} />);
    expect(screen.getByText('brand')).toBeTruthy();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('renders a labelled box for each question', () => {
    render(<GapsPanel gaps={[wine, oven]} onAnswer={ok} />);
    expect(screen.getByLabelText('How much red wine did you add?')).toBeTruthy();
    expect(screen.getByLabelText('What temperature is the oven?')).toBeTruthy();
  });

  it('is a read-only list without onAnswer', () => {
    render(<GapsPanel gaps={[wine, brand]} />);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('How much red wine did you add?')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('disables the button until something is typed', async () => {
    render(<GapsPanel gaps={[wine]} onAnswer={ok} />);
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(wine.question), '  ');
    expect(button.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(wine.question), 'a lot');
    expect(button.disabled).toBe(false);
  });

  it('counts what will be sent', async () => {
    render(<GapsPanel gaps={[wine, oven]} onAnswer={ok} />);
    await userEvent.type(screen.getByLabelText(wine.question), '150ml');
    expect(screen.getByRole('button', { name: 'Answer 1 question' })).toBeTruthy();
    await userEvent.type(screen.getByLabelText(oven.question), '180C');
    expect(screen.getByRole('button', { name: 'Answer 2 questions' })).toBeTruthy();
  });

  it('sends only the answered gaps', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<GapsPanel gaps={[wine, oven, brand]} onAnswer={onAnswer} />);
    await userEvent.type(screen.getByLabelText(oven.question), '  180C ');
    await userEvent.click(screen.getByRole('button', { name: 'Answer 1 question' }));
    expect(onAnswer).toHaveBeenCalledWith([{ gap: oven, answer: '180C' }]);
  });

  it('never sends a blank or whitespace-only answer, so it cannot reach the asked list', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<GapsPanel gaps={[wine, oven]} onAnswer={onAnswer} />);
    await userEvent.type(screen.getByLabelText(wine.question), '   ');
    await userEvent.type(screen.getByLabelText(oven.question), '180C');
    await userEvent.click(screen.getByRole('button'));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0][0].map((a: { gap: unknown }) => a.gap)).toEqual([oven]);
  });

  it('bounds an answer at 200 characters', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<GapsPanel gaps={[wine]} onAnswer={onAnswer} />);
    const box = screen.getByLabelText(wine.question) as HTMLInputElement;
    expect(box.maxLength).toBe(MAX_ANSWER_CHARS);
    await userEvent.click(box);
    await userEvent.paste('x'.repeat(MAX_ANSWER_CHARS + 50));
    await userEvent.click(screen.getByRole('button'));
    expect(onAnswer.mock.calls[0][0][0].answer).toHaveLength(MAX_ANSWER_CHARS);
  });

  it('carries at most eight answers in one apply', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const gaps = Array.from({ length: 10 }, (_, i) => ({ about: `g${i}`, question: `Question ${i}?` }));
    render(<GapsPanel gaps={gaps} onAnswer={onAnswer} />);
    for (let i = 0; i < MAX_ANSWERS; i++) await userEvent.type(screen.getByLabelText(`Question ${i}?`), 'yes');
    // At the cap the remaining empty boxes stop taking answers.
    expect((screen.getByLabelText('Question 8?') as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: `Answer ${MAX_ANSWERS} questions` }));
    expect(onAnswer.mock.calls[0][0]).toHaveLength(MAX_ANSWERS);
  });

  it('keeps what was typed in every box when the apply rejects', async () => {
    const onAnswer = vi.fn().mockRejectedValue(new Error('nope'));
    const { rerender } = render(<GapsPanel gaps={[wine, oven]} onAnswer={onAnswer} />);
    await userEvent.type(screen.getByLabelText(wine.question), '150ml');
    await userEvent.type(screen.getByLabelText(oven.question), '18');
    await userEvent.click(screen.getByRole('button'));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    rerender(<GapsPanel gaps={[wine, oven]} onAnswer={onAnswer} error="Could not apply" />);
    // Let the rejection settle before asserting, so a late clear would be caught.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect((screen.getByLabelText(wine.question) as HTMLInputElement).value).toBe('150ml');
    expect((screen.getByLabelText(oven.question) as HTMLInputElement).value).toBe('18');
    expect(screen.getByRole('alert').textContent).toBe('Could not apply');
  });

  it('clears the boxes it sent when the apply resolves, and keeps the rest', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<GapsPanel gaps={[wine, oven]} onAnswer={onAnswer} />);
    await userEvent.type(screen.getByLabelText(wine.question), '150ml');
    // Whitespace is not an answer, so it is not sent and must survive the resolve.
    await userEvent.type(screen.getByLabelText(oven.question), '  ');
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect((screen.getByLabelText(wine.question) as HTMLInputElement).value).toBe(''));
  });

  it('drops answered questions and keeps what was typed in the rest', async () => {
    const { rerender } = render(<GapsPanel gaps={[wine, oven]} onAnswer={ok} />);
    await userEvent.type(screen.getByLabelText(wine.question), '150ml');
    await userEvent.type(screen.getByLabelText(oven.question), '18');
    rerender(<GapsPanel gaps={[wine, oven]} onAnswer={ok} applying />);
    rerender(<GapsPanel gaps={[oven]} onAnswer={ok} />);
    expect(screen.queryByLabelText(wine.question)).toBeNull();
    expect((screen.getByLabelText(oven.question) as HTMLInputElement).value).toBe('18');
  });

  it('shows a spinner and Answering… while applying', async () => {
    const { rerender, container } = render(<GapsPanel gaps={[wine]} onAnswer={ok} />);
    await userEvent.type(screen.getByLabelText(wine.question), '150ml');
    rerender(<GapsPanel gaps={[wine]} onAnswer={ok} applying />);
    const button = screen.getByRole('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toMatch(/Answering…/);
    expect(container.querySelector('.spinner')).toBeTruthy();
  });

  it('sends once however often the button is clicked while the apply is in flight', async () => {
    let settle!: () => void;
    const onAnswer = vi.fn(() => new Promise<void>((r) => { settle = r; }));
    render(<GapsPanel gaps={[wine, oven]} onAnswer={onAnswer} />);
    await userEvent.type(screen.getByLabelText(wine.question), '150ml');
    const button = screen.getByRole('button') as HTMLButtonElement;
    await userEvent.click(button);
    await userEvent.click(button);
    expect(onAnswer).toHaveBeenCalledTimes(1);
    // Button and boxes disable together while in flight.
    expect(button.disabled).toBe(true);
    expect((screen.getByLabelText(wine.question) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(oven.question) as HTMLInputElement).disabled).toBe(true);
    await act(async () => { settle(); });
    expect((screen.getByLabelText(oven.question) as HTMLInputElement).disabled).toBe(false);
  });
});
