// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecipeForm } from './RecipeForm';
import type { RecipeInput } from '../../../server/src/recipes/schema';

afterEach(cleanup);

const empty: RecipeInput = {
  title: '', description: null, origin: 'mine', sourceName: null, sourceUrl: null,
  servings: null, prepMinutes: null, cookMinutes: null, ingredients: [], steps: [],
  notes: null, tags: [], imageIds: [],
};

describe('RecipeForm', () => {
  it('calls onSave with parsed fields', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<RecipeForm initial={empty} onSave={onSave} />);
    await user.type(screen.getByLabelText('Title'), 'Pasta');
    await user.type(screen.getByLabelText('Servings'), '4');
    await user.type(screen.getByLabelText('Ingredients'), '# Sauce\n2 cups flour\nsalt to taste');
    await user.click(screen.getByRole('button', { name: '+ Add a step' }));
    await user.click(screen.getByRole('button', { name: '+ Add a step' }));
    await user.click(screen.getByRole('button', { name: '+ Add a step' }));
    await user.type(screen.getByLabelText('Step 1'), 'Boil');
    await user.type(screen.getByLabelText('Step 3'), 'Serve');
    await user.type(screen.getByLabelText('Tags'), 'Pasta, quick');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const out = onSave.mock.calls[0][0] as RecipeInput;
    expect(out.title).toBe('Pasta');
    expect(out.servings).toBe(4);
    expect(out.ingredients).toEqual([
      { group: 'Sauce', quantity: 2, unit: 'cups', item: 'flour', note: null },
      { group: 'Sauce', quantity: null, unit: null, item: 'salt to taste', note: null },
    ]);
    expect(out.steps.map((s) => s.text)).toEqual(['Boil', 'Serve']);
    expect(out.tags).toEqual(['Pasta', 'quick']);
  });

  it('blocks save with an inline error when title is empty', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<RecipeForm initial={empty} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Enter a title')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows gaps above the form', () => {
    render(<RecipeForm initial={empty} gaps={['No cook time', 'Unclear quantity']} onSave={() => {}} />);
    expect(screen.getByText('Check these')).toBeTruthy();
    expect(screen.getByText('No cook time')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('round-trips ingredients text', () => {
    const initial: RecipeInput = {
      ...empty, title: 'x',
      ingredients: [
        { group: null, quantity: 1.5, unit: 'tsp', item: 'salt', note: 'fine' },
        { group: 'Sauce', quantity: null, unit: null, item: 'basil', note: null },
      ],
    };
    const onSave = vi.fn();
    render(<RecipeForm initial={initial} onSave={onSave} />);
    const ta = screen.getByLabelText('Ingredients') as HTMLTextAreaElement;
    expect(ta.value).toBe('1.5 tsp salt (fine)\n# Sauce\nbasil');
  });

  describe('structured steps', () => {
    const H = 'f'.repeat(64) + '.jpg';
    const linked: RecipeInput = {
      ...empty,
      title: 'T',
      ingredients: [
        { group: null, quantity: null, unit: null, item: 'salt', note: null },
        { group: null, quantity: null, unit: null, item: 'pepper', note: null },
      ],
      steps: [{ text: 'Season', imageId: H, ingredients: [0, 1] }],
    };
    const save = async (edit?: (user: ReturnType<typeof userEvent.setup>) => Promise<void>, initial = linked) => {
      const onSave = vi.fn();
      const user = userEvent.setup();
      render(<RecipeForm initial={initial} onSave={onSave} />);
      await edit?.(user);
      await user.click(screen.getByRole('button', { name: 'Save' }));
      return (onSave.mock.calls[0][0] as RecipeInput).steps;
    };

    it('renders and keeps a legacy single-step recipe untouched', async () => {
      const legacy = { ...empty, title: 'T', steps: [{ text: 'Boil. Serve.', imageId: null, ingredients: [] }] };
      expect(await save(undefined, legacy)).toEqual(legacy.steps);
    });

    it('renders a legacy single-step recipe', () => {
      render(<RecipeForm initial={{ ...empty, steps: [{ text: 'Boil. Serve.', imageId: null, ingredients: [] }] }} onSave={() => {}} />);
      expect((screen.getByLabelText('Step 1') as HTMLTextAreaElement).value).toBe('Boil. Serve.');
    });

    it('keeps links and photo when nothing changed', async () => {
      expect(await save()).toEqual(linked.steps);
    });

    it('remaps links when the ingredient list is reordered', async () => {
      const steps = await save(async (user) => {
        fireEvent.change(screen.getByLabelText('Ingredients'), { target: { value: 'pepper\nsalt' } });
      });
      expect(steps).toEqual([{ text: 'Season', imageId: H, ingredients: [0, 1] }]);
    });

    it('drops only the link of a removed ingredient, keeping the photo', async () => {
      const steps = await save(async (user) => {
        fireEvent.change(screen.getByLabelText('Ingredients'), { target: { value: 'salt' } });
      });
      expect(steps).toEqual([{ text: 'Season', imageId: H, ingredients: [0] }]);
      expect(steps[0].ingredients.every((n) => n < 1)).toBe(true);
    });

    it('updates chips immediately when ingredients change', async () => {
      const user = userEvent.setup();
      render(<RecipeForm initial={linked} onSave={() => {}} />);
      fireEvent.change(screen.getByLabelText('Ingredients'), { target: { value: 'pepper' } });
      expect(screen.queryByRole('button', { name: 'salt' })).toBeNull();
      expect(screen.getByRole('button', { name: 'pepper' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('keeps a step with blank text and a photo but no links', async () => {
      const steps = await save(async (user) => {
        await user.clear(screen.getByLabelText('Step 1'));
        await user.click(screen.getByRole('button', { name: 'salt' }));
        await user.click(screen.getByRole('button', { name: 'pepper' }));
      });
      expect(steps).toEqual([{ text: '', imageId: H, ingredients: [] }]);
    });

    it('keeps a step with blank text and links but no photo', async () => {
      const steps = await save(async (user) => {
        await user.clear(screen.getByLabelText('Step 1'));
        await user.click(screen.getByRole('button', { name: 'Remove photo for step 1' }));
      });
      expect(steps).toEqual([{ text: '', imageId: null, ingredients: [0, 1] }]);
    });

    it('drops a step with blank text, no photo and no links', async () => {
      const steps = await save(async (user) => {
        await user.clear(screen.getByLabelText('Step 1'));
        await user.click(screen.getByRole('button', { name: 'Remove photo for step 1' }));
        await user.click(screen.getByRole('button', { name: 'salt' }));
        await user.click(screen.getByRole('button', { name: 'pepper' }));
      });
      expect(steps).toEqual([]);
    });

    it('drops a text-less step whose links are all out of range', async () => {
      const steps = await save(undefined, {
        ...linked,
        steps: [{ text: '', imageId: null, ingredients: [5] }],
      });
      expect(steps).toEqual([]);
    });

    it('a chip toggled after an ingredient edit survives the next ingredient edit (no focus events)', async () => {
      const user = userEvent.setup();
      render(<RecipeForm initial={linked} onSave={() => {}} />);
      const ta = screen.getByLabelText('Ingredients');
      fireEvent.change(ta, { target: { value: 'salt\npepper\nsugar' } });
      await user.click(screen.getByRole('button', { name: 'sugar' }));
      fireEvent.change(ta, { target: { value: 'salt\npepper\nsugar\nbasil' } });
      expect(screen.getByRole('button', { name: 'sugar' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('a step added after an ingredient edit keeps correct links on the next edit', async () => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      render(<RecipeForm initial={linked} onSave={onSave} />);
      const ta = screen.getByLabelText('Ingredients');
      fireEvent.change(ta, { target: { value: 'pepper\nsalt' } });
      await user.click(screen.getByRole('button', { name: '+ Add a step' }));
      await user.type(screen.getByLabelText('Step 2'), 'New');
      await user.click(screen.getAllByRole('button', { name: 'salt' })[1]);
      fireEvent.change(ta, { target: { value: 'basil\npepper\nsalt' } });
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect((onSave.mock.calls[0][0] as RecipeInput).steps.map((x) => x.ingredients)).toEqual([[1, 2], [2]]);
    });

    it('keeps the link through keystroke edits and restores it when text is restored', async () => {
      const one: RecipeInput = {
        ...linked,
        ingredients: [{ group: null, quantity: 2, unit: 'cups', item: 'flour', note: null }],
        steps: [{ text: 'Mix', imageId: null, ingredients: [0] }],
      };
      const user = userEvent.setup();
      const onSave = vi.fn();
      render(<RecipeForm initial={one} onSave={onSave} />);
      const ta = screen.getByLabelText('Ingredients') as HTMLTextAreaElement;
      await user.click(ta);
      await user.clear(ta);
      await user.type(ta, 'cups flour');
      await user.clear(ta);
      await user.type(ta, '3 cups flour');
      expect(screen.getByRole('button', { name: '3 cups flour' }).getAttribute('aria-pressed')).toBe('true');
      await user.clear(ta);
      await user.type(ta, 'sugar');
      expect(screen.getByRole('button', { name: 'sugar' }).getAttribute('aria-pressed')).toBe('false');
      await user.clear(ta);
      await user.type(ta, '2 cups flour');
      expect(screen.getByRole('button', { name: '2 cups flour' }).getAttribute('aria-pressed')).toBe('true');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect((onSave.mock.calls[0][0] as RecipeInput).steps[0].ingredients).toEqual([0]);
    });

    it('keeps text edits independent of links and drops empty steps', async () => {
      const steps = await save(async (user) => {
        await user.type(screen.getByLabelText('Step 1'), '!');
        await user.click(screen.getByRole('button', { name: '+ Add a step' }));
      });
      expect(steps).toEqual([{ text: 'Season!', imageId: H, ingredients: [0, 1] }]);
    });
  });
});
