// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Photos } from './Photos';
import { getDraft, listDrafts, putDraft } from '../lib/drafts';
import type { PhotosDraft } from '../api';

vi.mock('../api', async () => ({
  ...(await vi.importActual<typeof import('../api')>('../api')),
  photosRecipe: vi.fn(), saveRecipe: vi.fn(), uploadImage: vi.fn(), cropImage: vi.fn(),
}));
vi.mock('../lib/shrinkImage', () => ({ shrinkImage: async (f: File) => f }));
vi.mock('react-easy-crop', () => ({
  default: (p: { onCropComplete(a: unknown, b: unknown): void }) => (
    <button type="button" onClick={() => p.onCropComplete({ x: 10, y: 20, width: 50, height: 40 }, {})}>move crop</button>
  ),
}));
import { ApiError, cropImage, photosRecipe, saveRecipe, uploadImage } from '../api';

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  vi.mocked(photosRecipe).mockReset();
  vi.mocked(saveRecipe).mockReset();
  vi.mocked(uploadImage).mockReset();
  vi.mocked(cropImage).mockReset();
});

const draft: PhotosDraft = {
  title: 'Chicken tray bake', description: null, origin: 'other', brand: 'HelloFresh', sourceName: null, sourceUrl: null,
  servings: 2, prepMinutes: null, cookMinutes: null,
  ingredients: [{ group: null, quantity: null, unit: null, item: 'chicken', note: null }],
  steps: [{ text: 'Roast it', imageId: null, ingredients: [] }], notes: null, tags: [],
  imageIds: ['crop.jpg', 'front.jpg', 'back.jpg'], gaps: [{ about: 'quantity for chicken', question: null }],
  dishCrop: { sourceImageId: 'front.jpg', x0: 100, y0: 100, x1: 600, y1: 600 },
};

const jpg = (n: string) => new File([n], `${n}.jpg`, { type: 'image/jpeg' });
const ids: Record<string, string> = { a: 'front.jpg', b: 'back.jpg' };

function app(url = '/photos') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/photos" element={<Photos />} />
        <Route path="/recipe/:id" element={<p>cook page</p>} />
        <Route path="/" element={<p>library</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
const picker = () => screen.getByLabelText('Add photos') as HTMLInputElement;
const thumbs = () => screen.getAllByRole('listitem').filter((li) => li.querySelector('img'));

async function pickTwo(user: ReturnType<typeof userEvent.setup>) {
  vi.mocked(uploadImage).mockImplementation(async (f) => ids[f.name.replace('.jpg', '')]!);
  await user.upload(picker(), [jpg('a'), jpg('b')]);
  await waitFor(() => expect(thumbs()).toHaveLength(2));
}

describe('Photos', () => {
  it('uploads each picked photo and shows thumbnails in order', async () => {
    const user = userEvent.setup();
    app();
    await pickTwo(user);
    expect(uploadImage).toHaveBeenCalledTimes(2);
    expect(thumbs().map((li) => li.querySelector('img')!.getAttribute('src'))).toEqual([
      '/api/images/front.jpg/thumb', '/api/images/back.jpg/thumb',
    ]);
  });

  it('shows the same photo once', async () => {
    vi.mocked(uploadImage).mockResolvedValue('same.jpg');
    const user = userEvent.setup();
    app();
    await user.upload(picker(), [jpg('a'), jpg('b')]);
    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(2));
    expect(thumbs()).toHaveLength(1);
  });

  it('reorders and removes photos', async () => {
    const user = userEvent.setup();
    app();
    await pickTwo(user);
    await user.click(screen.getByRole('button', { name: 'Move photo 2 earlier' }));
    expect(thumbs().map((li) => li.querySelector('img')!.getAttribute('src'))).toEqual([
      '/api/images/back.jpg/thumb', '/api/images/front.jpg/thumb',
    ]);
    await user.click(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect(thumbs()).toHaveLength(1);
  });

  it('disables Create draft with no photos or while uploading', async () => {
    let release: (id: string) => void = () => {};
    vi.mocked(uploadImage).mockReturnValue(new Promise((r) => { release = r; }));
    const user = userEvent.setup();
    app();
    const create = () => screen.getByRole('button', { name: /create draft/i }) as HTMLButtonElement;
    expect(create().disabled).toBe(true);
    await user.upload(picker(), [jpg('a')]);
    expect(create().disabled).toBe(true);
    release('front.jpg');
    await waitFor(() => expect(create().disabled).toBe(false));
  });

  it('allows at most 6 photos', async () => {
    let n = 0;
    vi.mocked(uploadImage).mockImplementation(async () => `p${n++}.jpg`);
    const user = userEvent.setup();
    app();
    expect(screen.getByText('Up to 6 photos')).toBeTruthy();
    await user.upload(picker(), Array.from({ length: 6 }, (_, i) => jpg(`f${i}`)));
    await waitFor(() => expect(thumbs()).toHaveLength(6));
    expect(picker().disabled).toBe(true);
  });

  it('uploads only the free slots, says how many were skipped, and blocks a second pick while uploading', async () => {
    let n = 0;
    let release: () => void = () => {};
    vi.mocked(uploadImage).mockImplementation(async () => {
      if (n === 0) await new Promise<void>((r) => { release = r; });
      return `p${n++}.jpg`;
    });
    const user = userEvent.setup();
    app();
    await user.upload(picker(), Array.from({ length: 7 }, (_, i) => jpg(`f${i}`)));
    expect(screen.getByText('Only 6 photos — 1 skipped').getAttribute('role')).toBe('status');
    expect(picker().disabled).toBe(true);
    release();
    await waitFor(() => expect(thumbs()).toHaveLength(6));
    expect(uploadImage).toHaveBeenCalledTimes(6);
  });

  it('creates a draft from the photos in order and shows the form with gaps', async () => {
    vi.mocked(photosRecipe).mockResolvedValue(draft);
    const user = userEvent.setup();
    app();
    await pickTwo(user);
    await user.click(screen.getByRole('button', { name: /create draft/i }));
    expect(await screen.findByText('quantity for chicken')).toBeTruthy();
    expect(photosRecipe).toHaveBeenCalledWith(['front.jpg', 'back.jpg']);
    expect(saveRecipe).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Chicken tray bake');
  });

  it('shows the API message for a coded failure', async () => {
    const msg = 'The AI account is out of credit. Add credit or switch provider.';
    vi.mocked(photosRecipe).mockRejectedValue(new ApiError(msg, 502, { error: msg, code: 'no_credit' }));
    const user = userEvent.setup();
    app();
    await pickTwo(user);
    await user.click(screen.getByRole('button', { name: /create draft/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(msg));
  });

  it('says AI is not configured', async () => {
    vi.mocked(photosRecipe).mockRejectedValue(new Error('AI not configured'));
    const user = userEvent.setup();
    app();
    await pickTwo(user);
    await user.click(screen.getByRole('button', { name: /create draft/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not configured/i));
  });

  it('saves the recipe with the cropped dish photo first', async () => {
    vi.mocked(photosRecipe).mockResolvedValue(draft);
    vi.mocked(saveRecipe).mockResolvedValue({ ...draft, id: 'n1', createdAt: '', updatedAt: '', favouritedBy: [] });
    const user = userEvent.setup();
    app();
    await pickTwo(user);
    await user.click(screen.getByRole('button', { name: /create draft/i }));
    await user.click(await screen.findByRole('button', { name: /^save/i }));
    await screen.findByText('cook page');
    const saved = vi.mocked(saveRecipe).mock.calls[0]![1] as Record<string, unknown>;
    expect(saved.imageIds).toEqual(['crop.jpg', 'front.jpg', 'back.jpg']);
    expect(saved).not.toHaveProperty('dishCrop');
    expect(saved).not.toHaveProperty('gaps');
  });

  it('clears the kept draft after a successful save', async () => {
    vi.mocked(photosRecipe).mockResolvedValue(draft);
    vi.mocked(saveRecipe).mockResolvedValue({ ...draft, id: 'n1', createdAt: '', updatedAt: '', favouritedBy: [] });
    const user = userEvent.setup();
    app();
    await pickTwo(user);
    await user.click(screen.getByRole('button', { name: /create draft/i }));
    expect(listDrafts()).toHaveLength(1);
    await user.click(await screen.findByRole('button', { name: /^save/i }));
    await screen.findByText('cook page');
    cleanup();
    expect(listDrafts()).toEqual([]);
  });

  it('resumes a kept draft with its photos and form', () => {
    putDraft({
      id: 'p1', kind: 'photos', savedAt: 1, photoIds: ['front.jpg', 'back.jpg'],
      input: { ...draft, gaps: undefined } as never, gaps: [{ about: 'quantity for chicken', question: null }], dishCrop: draft.dishCrop,
    });
    app('/photos?draft=p1');
    expect(thumbs().filter((li) => li.closest('.photo-picker'))).toHaveLength(2);
    expect(screen.getByText('quantity for chicken')).toBeTruthy();
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Chicken tray bake');
    expect(screen.getByRole('button', { name: 'Use whole photo' })).toBeTruthy();
  });

  describe('dish photo', () => {
    async function withDraft() {
      vi.mocked(photosRecipe).mockResolvedValue(draft);
      const user = userEvent.setup();
      app();
      await pickTwo(user);
      await user.click(screen.getByRole('button', { name: /create draft/i }));
      await screen.findByText('quantity for chicken');
      return user;
    }
    const formPhotos = () => within(document.querySelector('.recipe-form .photo-list') as HTMLElement);

    it('Use whole photo swaps the first image for the card photo and hides the actions', async () => {
      const user = await withDraft();
      expect(screen.getByRole('button', { name: 'Adjust' })).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Use whole photo' }));
      const srcs = formPhotos().getAllByRole('img').map((i) => i.getAttribute('src'));
      expect(srcs).toEqual(['/api/images/front.jpg/thumb', '/api/images/back.jpg/thumb']);
      expect(screen.queryByRole('button', { name: 'Adjust' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Use whole photo' })).toBeNull();
    });

    it('Adjust crops the source photo with the new box and replaces the first image', async () => {
      vi.mocked(cropImage).mockResolvedValue('crop2.jpg');
      const user = await withDraft();
      await user.click(screen.getByRole('button', { name: 'Adjust' }));
      await user.click(screen.getByText('move crop'));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(cropImage).toHaveBeenCalledWith('front.jpg', { x0: 100, y0: 200, x1: 600, y1: 600 }));
      await waitFor(() =>
        expect(formPhotos().getAllByRole('img').map((i) => i.getAttribute('src'))).toEqual([
          '/api/images/crop2.jpg/thumb', '/api/images/front.jpg/thumb', '/api/images/back.jpg/thumb',
        ]),
      );
      expect(screen.getByRole('button', { name: 'Adjust' })).toBeTruthy();
    });

    it('shows no actions once the crop photo is removed, even if another photo moves to the front', async () => {
      vi.mocked(photosRecipe).mockResolvedValue({ ...draft, dishCrop: { sourceImageId: 'back.jpg', x0: 100, y0: 100, x1: 600, y1: 600 } });
      const user = userEvent.setup();
      app();
      await pickTwo(user);
      await user.click(screen.getByRole('button', { name: /create draft/i }));
      await screen.findByText('quantity for chicken');
      await user.click(within(document.querySelector('.recipe-form') as HTMLElement).getByRole('button', { name: 'Remove photo 1' }));
      expect(formPhotos().getAllByRole('img')).toHaveLength(2);
      expect(screen.queryByRole('button', { name: 'Adjust' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Use whole photo' })).toBeNull();
      expect(listDrafts()[0]!.dishCrop).toBeNull();
    });

    it('keeps the adjusted box in the draft, and a resume starts from it', async () => {
      vi.mocked(cropImage).mockResolvedValue('crop2.jpg');
      const user = await withDraft();
      await user.click(screen.getByRole('button', { name: 'Adjust' }));
      await user.click(screen.getByText('move crop'));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(formPhotos().getAllByRole('img')[0]!.getAttribute('src')).toBe('/api/images/crop2.jpg/thumb'));
      const id = listDrafts()[0]!.id;
      cleanup();
      expect(getDraft(id)!.dishCrop).toEqual({ sourceImageId: 'front.jpg', x0: 100, y0: 200, x1: 600, y1: 600 });
      app(`/photos?draft=${id}`);
      await user.click(screen.getByRole('button', { name: 'Adjust' }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(cropImage).toHaveBeenCalledTimes(2));
      expect(vi.mocked(cropImage).mock.calls[1]![1]).toEqual({ x0: 100, y0: 200, x1: 600, y1: 600 });
    });

    it('Use whole photo clears the kept crop', async () => {
      const user = await withDraft();
      await user.click(screen.getByRole('button', { name: 'Use whole photo' }));
      expect(listDrafts()[0]!.dishCrop).toBeNull();
    });

    it('Adjust starts from the box last saved', async () => {
      vi.mocked(cropImage).mockResolvedValue('crop2.jpg');
      const user = await withDraft();
      await user.click(screen.getByRole('button', { name: 'Adjust' }));
      await user.click(screen.getByText('move crop'));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await user.click(screen.getByRole('button', { name: 'Adjust' }));
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(cropImage).toHaveBeenCalledTimes(2));
      expect(vi.mocked(cropImage).mock.calls[1]![1]).toEqual({ x0: 100, y0: 200, x1: 600, y1: 600 });
    });
  });
});
