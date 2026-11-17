// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterSheet } from './FilterSheet';
import type { Facets } from '../api';

afterEach(cleanup);

const facets: Facets = {
  brands: Array.from({ length: 10 }, (_, i) => ({ name: `Brand${i + 1}`, count: 20 - i })),
  tags: [
    { group: 'cuisine', name: 'Thai', count: 3 },
    { group: 'meal', name: 'Dinner', count: 2 },
  ],
};

function setup(over: Partial<React.ComponentProps<typeof FilterSheet>> = {}) {
  const props = {
    open: true, facets, filters: { brands: [], tags: [] }, count: 4,
    onChange: vi.fn(), onClose: vi.fn(), ...over,
  };
  render(<FilterSheet {...props} />);
  return props;
}

describe('FilterSheet', () => {
  it('renders nothing when closed', () => {
    setup({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('is a labelled modal dialog with Brand then group sections, skipping empty groups', () => {
    setup();
    const d = screen.getByRole('dialog', { name: 'Filters' });
    expect(d.getAttribute('aria-modal')).toBe('true');
    const heads = [...d.querySelectorAll('h3')].map((h) => h.textContent);
    expect(heads).toEqual(['Brand', 'Cuisine', 'Meal']);
  });
  it('shows top 8 brands then More reveals the rest', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.queryByRole('button', { name: 'Brand9' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Brand8' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('button', { name: 'Brand10' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });
  it('toggles chips via onChange and reflects aria-pressed', async () => {
    const user = userEvent.setup();
    const p = setup({ filters: { brands: ['Brand1'], tags: [] } });
    expect(screen.getByRole('button', { name: 'Brand1' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Thai' }));
    expect(p.onChange).toHaveBeenLastCalledWith({ brands: ['Brand1'], tags: [{ group: 'cuisine', name: 'Thai' }] });
    await user.click(screen.getByRole('button', { name: 'Brand1' }));
    expect(p.onChange).toHaveBeenLastCalledWith({ brands: [], tags: [] });
  });
  it('Clear all empties; Show N recipes closes', async () => {
    const user = userEvent.setup();
    const p = setup({ filters: { brands: ['Brand1'], tags: [] } });
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(p.onChange).toHaveBeenLastCalledWith({ brands: [], tags: [] });
    await user.click(screen.getByRole('button', { name: 'Show 4 recipes' }));
    expect(p.onClose).toHaveBeenCalled();
  });
  it('Escape and backdrop close; focus moves into the dialog', async () => {
    const user = userEvent.setup();
    const p = setup();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(p.onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('filter-backdrop'));
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
  it('singular count', () => {
    setup({ count: 1 });
    expect(screen.getByRole('button', { name: 'Show 1 recipe' })).toBeTruthy();
  });
});
