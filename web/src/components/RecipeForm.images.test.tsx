// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeForm } from './RecipeForm';
import type { RecipeInput } from '../../../server/src/recipes/schema';

let impl: (f: File) => Promise<string>;
vi.mock('../api', () => ({ uploadImage: (f: File) => impl(f) }));

beforeEach(() => {
  impl = async () => 'unset.jpg';
});
afterEach(cleanup);

const empty: RecipeInput = {
  title: 'Soup', description: null, origin: 'mine', sourceName: null, sourceUrl: null,
  servings: null, prepMinutes: null, cookMinutes: null, ingredients: [], steps: [],
  notes: null, tags: [], imageIds: [],
};
const file = (name = 'a.jpg') => new File(['x'], name, { type: 'image/jpeg' });
const picker = () => screen.getByLabelText('Add photos') as HTMLInputElement;

describe('RecipeForm images', () => {
  it('has a file input accepting images (camera on phones)', () => {
    render(<RecipeForm initial={empty} onSave={() => {}} />);
    expect(picker().type).toBe('file');
    expect(picker().accept).toBe('image/*');
  });

  it('uploads a chosen file, shows a thumbnail, and saves the id', async () => {
    impl = async () => 'abc.jpg';
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<RecipeForm initial={empty} onSave={onSave} />);
    await user.upload(picker(), file());
    const img = (await screen.findByAltText('Photo 1')) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/images/abc.jpg/thumb');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((onSave.mock.calls[0][0] as RecipeInput).imageIds).toEqual(['abc.jpg']);
  });

  it('removes an image from the recipe', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<RecipeForm initial={{ ...empty, imageIds: ['a.jpg', 'b.jpg'] }} onSave={onSave} />);
    await user.click(screen.getAllByRole('button', { name: /Remove photo/ })[0]);
    expect(screen.queryByAltText('Photo 2')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((onSave.mock.calls[0][0] as RecipeInput).imageIds).toEqual(['b.jpg']);
  });

  it('blocks Save with a message while an upload is in flight', async () => {
    let resolve!: (id: string) => void;
    impl = () => new Promise((r) => (resolve = r));
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<RecipeForm initial={empty} onSave={onSave} />);
    await user.upload(picker(), file());
    expect(screen.getByText(/Uploading/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/upload/i);
    resolve('new.jpg');
    await screen.findByAltText('Photo 1');
    expect(screen.queryByText(/Uploading/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows an inline error when an upload fails and adds nothing', async () => {
    impl = async () => {
      throw new Error('not a supported image');
    };
    const user = userEvent.setup();
    render(<RecipeForm initial={empty} onSave={() => {}} />);
    await user.upload(picker(), file());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/a\.jpg/));
    expect(screen.queryByAltText('Photo 1')).toBeNull();
  });
});

describe('RecipeForm step uploads', () => {
  it('blocks Save with a message while a step photo uploads', async () => {
    let resolve!: (id: string) => void;
    impl = () => new Promise((r) => (resolve = r));
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<RecipeForm initial={{ ...empty, steps: [{ text: 'Mix', imageId: null, ingredients: [] }] }} onSave={onSave} />);
    await user.upload(screen.getByLabelText('Add photo', { selector: 'input' }), file());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/Wait for the photo upload/);
    resolve('s.jpg');
    await screen.findByAltText('Photo for step 1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0][0] as RecipeInput).steps[0].imageId).toBe('s.jpg');
  });
});
