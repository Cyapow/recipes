// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviseBox, type ReviseBoxProps } from './ReviseBox';

afterEach(cleanup);

function setup(over: Partial<ReviseBoxProps> = {}) {
  const props: ReviseBoxProps = { busy: false, error: null, summary: null, onApply: vi.fn(), onUndo: vi.fn(), ...over };
  render(<ReviseBox {...props} />);
  return props;
}
const apply = () => screen.getByRole('button', { name: /revise/i }) as HTMLButtonElement;
const box = () => screen.getByRole('textbox') as HTMLTextAreaElement;

describe('ReviseBox', () => {
  it('does not apply an empty instruction', async () => {
    const p = setup();
    expect(apply().disabled).toBe(true);
    await userEvent.type(box(), '   ');
    expect(apply().disabled).toBe(true);
    await userEvent.type(box(), 'x');
    expect(apply().disabled).toBe(false);
    expect(p.onApply).not.toHaveBeenCalled();
  });
  it('hands the instruction over and keeps the text for a second go', async () => {
    const p = setup();
    await userEvent.type(box(), 'let it cool for 20 minutes');
    await userEvent.click(apply());
    expect(p.onApply).toHaveBeenCalledWith('let it cool for 20 minutes');
    expect(box().value).toBe('let it cool for 20 minutes');
  });
  it('disables the button and shows progress while busy', async () => {
    const p = setup({ busy: true });
    await userEvent.type(box(), 'something');
    const b = screen.getByRole('button', { name: /revising/i }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    await userEvent.click(b);
    expect(p.onApply).not.toHaveBeenCalled();
  });
  it('lists what changed and offers Undo', async () => {
    const p = setup({ summary: ['Step 2 added'] });
    expect(screen.getByText('Step 2 added')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(p.onUndo).toHaveBeenCalledTimes(1);
  });
  it('says a revision changed nothing rather than looking like it worked', () => {
    setup({ summary: [] });
    expect(screen.getByText(/no changes/i)).toBeTruthy();
  });
  it('shows no summary and no Undo before any revision', () => {
    setup({ summary: null });
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull();
    expect(screen.queryByText(/no changes/i)).toBeNull();
  });
  it('shows an error', () => {
    setup({ error: 'Could not revise: boom' });
    expect(screen.getByRole('alert').textContent).toBe('Could not revise: boom');
  });
});
