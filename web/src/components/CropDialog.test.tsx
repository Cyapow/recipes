// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CropDialog } from './CropDialog';

// jsdom has no layout, so the cropper is replaced by a button that reports a crop the way the real one does.
vi.mock('react-easy-crop', () => ({
  default: (p: { image: string; aspect: number; onCropComplete(a: unknown, b: unknown): void }) => (
    <button
      type="button"
      data-image={p.image}
      data-aspect={p.aspect}
      onClick={() => p.onCropComplete({ x: 10, y: 20, width: 50, height: 40 }, { x: 100, y: 200, width: 500, height: 400 })}
    >
      move crop
    </button>
  ),
}));

afterEach(cleanup);
const start = { x0: 100, y0: 100, x1: 600, y1: 600 };

describe('CropDialog', () => {
  it('shows the source photo', () => {
    render(<CropDialog imageId="src.jpg" box={start} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('move crop').getAttribute('data-image')).toBe('/api/images/src.jpg');
  });

  it('saves the chosen area as a 0-1000 box', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<CropDialog imageId="src.jpg" box={start} onSave={onSave} onCancel={() => {}} />);
    await user.click(screen.getByText('move crop'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ x0: 100, y0: 200, x1: 600, y1: 600 });
  });

  it('saves the starting box when nothing was moved', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<CropDialog imageId="src.jpg" box={start} onSave={onSave} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(start);
  });

  it('starts at the original shape and can change to Square', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<CropDialog imageId="src.jpg" box={start} onSave={onSave} onCancel={() => {}} />);
    expect(screen.getByText('move crop').getAttribute('data-aspect')).toBe('1');
    expect(screen.getByRole('button', { name: 'Original' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: '3:4' }));
    expect(screen.getByText('move crop').getAttribute('data-aspect')).toBe('0.75');
    await user.click(screen.getByRole('button', { name: '4:3' }));
    expect(Number(screen.getByText('move crop').getAttribute('data-aspect'))).toBeCloseTo(4 / 3);
    await user.click(screen.getByRole('button', { name: 'Square' }));
    expect(screen.getByText('move crop').getAttribute('data-aspect')).toBe('1');
    expect(screen.getByRole('button', { name: 'Square' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByText('move crop'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ x0: 100, y0: 200, x1: 600, y1: 600 });
  });

  it('keeps a wide original box wide', () => {
    render(<CropDialog imageId="src.jpg" box={{ x0: 0, y0: 0, x1: 800, y1: 400 }} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('move crop').getAttribute('data-aspect')).toBe('2');
  });

  it('cancels without saving', async () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<CropDialog imageId="src.jpg" box={start} onSave={onSave} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
