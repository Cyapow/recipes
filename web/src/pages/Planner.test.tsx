// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Planner } from './Planner';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  listRecipes: vi.fn(), getPlan: vi.fn(), getBudget: vi.fn(), saveBudget: vi.fn(), savePrice: vi.fn(),
  getRecipe: vi.fn(), addToShopping: vi.fn(),
}));
import { addToShopping, ApiError, getBudget, getPlan, getRecipe, listRecipes, saveBudget, savePrice } from '../api';

const summary = (id: string, title: string) => ({ id, title, origin: 'mine', sourceName: null, tags: [], thumbnailId: null, totalMinutes: null }) as never;
const plan = (over: object = {}) => ({
  selected: [{ id: 'soup', title: 'Carrot soup' }],
  basket: {
    items: [
      { key: 'carrot', item: 'carrot', pricePence: 80, usedBy: ['Carrot soup'] },
      { key: 'stock', item: 'stock', pricePence: null, usedBy: ['Carrot soup'] },
    ],
    totalPence: 80, unpriced: ['stock'],
  },
  suggestions: [{ id: 'stew', title: 'Stew', shared: ['carrot'], extra: ['beef mince'], extraPence: 400, unpricedExtra: [] }],
  budgetPence: 7000,
  ...over,
}) as never;

const view = () => render(<MemoryRouter><Planner /></MemoryRouter>);

beforeEach(() => {
  vi.mocked(listRecipes).mockReset().mockResolvedValue([summary('soup', 'Carrot soup'), summary('stew', 'Stew')]);
  vi.mocked(getBudget).mockReset().mockResolvedValue(7000);
  vi.mocked(saveBudget).mockReset().mockResolvedValue(undefined);
  vi.mocked(getPlan).mockReset().mockResolvedValue(plan());
  vi.mocked(savePrice).mockReset().mockResolvedValue(undefined);
  vi.mocked(getRecipe).mockReset().mockResolvedValue({ ingredients: [{}, {}] } as never);
  vi.mocked(addToShopping).mockReset().mockResolvedValue({ added: 2 });
});
afterEach(cleanup);

describe('Planner', () => {
  it('shows the saved budget and asks for nothing until a recipe is picked', async () => {
    view();
    expect(await screen.findByLabelText('Carrot soup')).toBeTruthy();
    expect((screen.getByPlaceholderText('e.g. 70') as HTMLInputElement).value).toBe('70.00');
    expect(screen.queryByText('Estimated cost')).toBeNull();
    expect(getPlan).not.toHaveBeenCalled();
  });

  it('shows cost against budget, unpriced items and the suggestions once a recipe is ticked', async () => {
    view();
    await userEvent.click(await screen.findByLabelText('Carrot soup'));
    expect(getPlan).toHaveBeenCalledWith(['soup']);
    await screen.findByText('Estimated cost');
    expect(document.querySelector('.planner-total')!.textContent).toBe('£0.80 of £70.00');
    expect(screen.getByText('£69.20 left')).toBeTruthy();
    expect(screen.getByText('1 item has no price yet, so this is a minimum.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Suggestions' })).getByText('Stew')).toBeTruthy();
    expect(screen.getByText(/Needs 1 extra thing: Beef mince/)).toBeTruthy();
  });

  it('warns when over budget', async () => {
    vi.mocked(getPlan).mockResolvedValue(plan({ budgetPence: 50 }));
    view();
    await userEvent.click(await screen.findByLabelText('Carrot soup'));
    expect(await screen.findByText('£0.30 over budget')).toBeTruthy();
  });

  it('adding a suggestion ticks it and re-plans with both', async () => {
    view();
    await userEvent.click(await screen.findByLabelText('Carrot soup'));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Stew' }));
    expect(getPlan).toHaveBeenLastCalledWith(['soup', 'stew']);
    expect((screen.getByLabelText('Stew') as HTMLInputElement).checked).toBe(true);
  });

  it('saves a typed price and re-plans', async () => {
    view();
    await userEvent.click(await screen.findByLabelText('Carrot soup'));
    await userEvent.type(await screen.findByLabelText('Price of stock'), '1.10');
    await userEvent.type(screen.getByLabelText('Clubcard price of stock'), '0.90');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(savePrice).toHaveBeenCalledWith('stock', 110, 90));
    await waitFor(() => expect(getPlan).toHaveBeenCalledTimes(2));
  });

  it('refuses a bad price without calling the server', async () => {
    view();
    await userEvent.click(await screen.findByLabelText('Carrot soup'));
    await userEvent.type(await screen.findByLabelText('Price of stock'), 'lots');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Enter prices like 1.50')).toBeTruthy();
    expect(savePrice).not.toHaveBeenCalled();
  });

  it('saves the budget when the field loses focus', async () => {
    view();
    const box = await screen.findByPlaceholderText('e.g. 70');
    await userEvent.clear(box);
    await userEvent.type(box, '65');
    await userEvent.tab();
    await waitFor(() => expect(saveBudget).toHaveBeenCalledWith(6500));
  });

  it('adds every picked recipe to the shopping list and reports ones already there', async () => {
    vi.mocked(addToShopping).mockRejectedValueOnce(new ApiError('x', 409, { error: 'already_on_list' }));
    view();
    await userEvent.click(await screen.findByLabelText('Carrot soup'));
    await userEvent.click(await screen.findByRole('button', { name: 'Add 1 recipe to shopping list' }));
    expect(addToShopping).toHaveBeenCalledWith('soup', [0, 1]);
    expect(await screen.findByText(/Already on the list: Carrot soup/)).toBeTruthy();
  });
});
