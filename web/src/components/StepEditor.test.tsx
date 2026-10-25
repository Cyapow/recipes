// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepEditor } from './StepEditor';
import type { Ingredient, Step } from '../../../server/src/recipes/schema';

let impl: (f: File) => Promise<string>;
vi.mock('../api', () => ({ uploadImage: (f: File) => impl(f) }));

beforeEach(() => {
  impl = async () => 'new.jpg';
});
afterEach(cleanup);

const ings: Ingredient[] = [
  { group: null, quantity: 2, unit: 'cups', item: 'flour', note: null },
  { group: null, quantity: null, unit: null, item: 'salt', note: null },
];
const file = () => new File(['x'], 'a.jpg', { type: 'image/jpeg' });

function Harness({ initial, busy }: { initial: Step[]; busy?: (b: boolean) => void }) {
  const [steps, setSteps] = useState(initial);
  return (
    <>
      <StepEditor steps={steps} ingredients={ings} onChange={setSteps} onBusyChange={busy ?? (() => {})} />
      <output data-testid="out">{JSON.stringify(steps)}</output>
    </>
  );
}
const out = (): Step[] => JSON.parse(screen.getByTestId('out').textContent!);
const s = (text: string, ingredients: number[] = [], imageId: string | null = null): Step => ({ text, imageId, ingredients });

describe('StepEditor', () => {
  it('edits step text', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[s('Mix')]} />);
    await user.type(screen.getByLabelText('Step 1'), '!');
    expect(out()[0].text).toBe('Mix!');
  });

  it('toggles ingredient chips with aria-pressed', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[s('Mix', [1])]} />);
    const flour = screen.getByRole('button', { name: '2 cups flour' });
    const salt = screen.getByRole('button', { name: 'salt' });
    expect(flour.getAttribute('aria-pressed')).toBe('false');
    expect(salt.getAttribute('aria-pressed')).toBe('true');
    await user.click(flour);
    expect(out()[0].ingredients).toEqual([0, 1]);
    await user.click(salt);
    expect(out()[0].ingredients).toEqual([0]);
  });

  it('uploads a photo, shows thumbnail, then removes it', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[s('Mix')]} />);
    await user.upload(screen.getByLabelText('Add photo', { selector: 'input' }), file());
    const img = (await screen.findByAltText('Photo for step 1')) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/images/new.jpg/thumb');
    expect(out()[0].imageId).toBe('new.jpg');
    expect(screen.getByText('Replace photo')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove photo for step 1' }));
    expect(out()[0].imageId).toBeNull();
  });

  it('shows an error and leaves imageId unchanged on failed upload', async () => {
    impl = async () => {
      throw new Error('not a supported image');
    };
    const user = userEvent.setup();
    render(<Harness initial={[s('Mix', [], 'old.jpg')]} />);
    await user.upload(screen.getByLabelText('Replace photo', { selector: 'input' }), file());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not a supported image/));
    expect(out()[0].imageId).toBe('old.jpg');
  });

  it('reports busy during upload and not after', async () => {
    let resolve!: (id: string) => void;
    impl = () => new Promise((r) => (resolve = r));
    const busy = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={[s('Mix')]} busy={busy} />);
    await user.upload(screen.getByLabelText('Add photo', { selector: 'input' }), file());
    expect(busy).toHaveBeenLastCalledWith(true);
    resolve('x.jpg');
    await screen.findByAltText('Photo for step 1');
    expect(busy).toHaveBeenLastCalledWith(false);
  });

  it('stays busy and ignores the late result when the step is deleted mid-upload', async () => {
    let resolve!: (id: string) => void;
    impl = () => new Promise((r) => (resolve = r));
    const busy = vi.fn();
    const user = userEvent.setup();
    render(<Harness initial={[s('A'), s('B')]} busy={busy} />);
    await user.upload(screen.getAllByLabelText('Add photo', { selector: 'input' })[0], file());
    await user.click(screen.getByRole('button', { name: 'Delete step 1' }));
    expect(busy).toHaveBeenLastCalledWith(true);
    resolve('late.jpg');
    await waitFor(() => expect(busy).toHaveBeenLastCalledWith(false));
    expect(out()).toEqual([s('B')]);
  });

  it('does not crash when the upload resolves after unmount', async () => {
    let resolve!: (id: string) => void;
    impl = () => new Promise((r) => (resolve = r));
    const user = userEvent.setup();
    const { unmount } = render(<Harness initial={[s('A')]} />);
    await user.upload(screen.getByLabelText('Add photo', { selector: 'input' }), file());
    unmount();
    resolve('x.jpg');
    await Promise.resolve();
  });

  it('adds, deletes and moves steps; links and photo travel', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[s('A', [0], 'a.jpg'), s('B', [1])]} />);
    await user.click(screen.getByRole('button', { name: 'Move step 1 down' }));
    expect(out()).toEqual([s('B', [1]), s('A', [0], 'a.jpg')]);
    await user.click(screen.getByRole('button', { name: 'Move step 2 up' }));
    expect(out()).toEqual([s('A', [0], 'a.jpg'), s('B', [1])]);
    await user.click(screen.getByRole('button', { name: '+ Add a step' }));
    expect(out()).toHaveLength(3);
    expect(out()[2]).toEqual(s(''));
    await user.click(screen.getByRole('button', { name: 'Delete step 1' }));
    expect(out().map((x) => x.text)).toEqual(['B', '']);
  });

  it('keeps both photos when two uploads resolve in the same tick', async () => {
    const resolvers: ((id: string) => void)[] = [];
    impl = () => new Promise((r) => resolvers.push(r));
    const user = userEvent.setup();
    render(<Harness initial={[s('A'), s('B')]} />);
    const inputs = screen.getAllByLabelText(/Add photo for step/, { selector: 'input' });
    await user.upload(inputs[0], file());
    await user.upload(inputs[1], file());
    await act(async () => {
      resolvers[0]('one.jpg');
      resolvers[1]('two.jpg');
    });
    expect(out().map((x) => x.imageId)).toEqual(['one.jpg', 'two.jpg']);
  });

  it('lands the photo on the right step when it was moved mid-upload', async () => {
    let resolve!: (id: string) => void;
    impl = () => new Promise((r) => (resolve = r));
    const user = userEvent.setup();
    render(<Harness initial={[s('A'), s('B')]} />);
    await user.upload(screen.getByLabelText('Add photo for step 1', { selector: 'input' }), file());
    await user.click(screen.getByRole('button', { name: 'Move step 1 down' }));
    await act(async () => resolve('moved.jpg'));
    expect(out()).toEqual([s('B'), s('A', [], 'moved.jpg')]);
  });

  it('disables move up on first and move down on last', () => {
    render(<Harness initial={[s('A'), s('B')]} />);
    expect((screen.getByRole('button', { name: 'Move step 1 up' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move step 2 down' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
