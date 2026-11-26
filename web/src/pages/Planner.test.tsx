// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Planner } from './Planner';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  listRecipes: vi.fn(), getPlan: vi.fn(), getBudget: vi.fn(), saveBudget: vi.fn(), addPlanToShopping: vi.fn(),
}));
import { addPlanToShopping, getBudget, getPlan, listRecipes, saveBudget } from '../api';

const summary = (id: string, title: string) => ({ id, title, origin: 'mine', sourceName: null, tags: [], thumbnailId: null, totalMinutes: null }) as never;
const item = (over: object) => ({
  key: 'x', item: 'x', shop: null, pricePence: 80, picks: [{ label: 'each', count: 1, pence: 80 }],
  needed: 1, unit: '', unclear: false, leftover: null, usedBy: ['Carrot soup'], ...over,
});
const plan = (over: object = {}) => ({
  selected: [{ id: 'soup', title: 'Carrot soup' }],
  basket: {
    items: [item({ key: 'carrot', item: 'carrot' }), item({ key: 'stock', item: 'stock', pricePence: null, picks: [], needed: null })],
    totalPence: 80, byShop: [{ shop: null, totalPence: 80 }], unpriced: ['stock'],
  },
  suggestions: [{ id: 'stew', title: 'Stew', shared: ['carrot'], extra: [{ item: 'beef mince', shop: null }], extraPence: 400, unpricedExtra: [] }],
  budgetPence: 7000,
  defaultShop: 'Tesco',
  ...over,
}) as never;

const view = () => render(<MemoryRouter><Planner /></MemoryRouter>);
const pickSoup = async () => userEvent.click(await screen.findByLabelText('Carrot soup'));

beforeEach(() => {
  vi.mocked(listRecipes).mockReset().mockResolvedValue([summary('soup', 'Carrot soup'), summary('stew', 'Stew')]);
  vi.mocked(getBudget).mockReset().mockResolvedValue(7000);
  vi.mocked(saveBudget).mockReset().mockResolvedValue(undefined);
  vi.mocked(getPlan).mockReset().mockResolvedValue(plan());
  vi.mocked(addPlanToShopping).mockReset().mockResolvedValue({ added: 1, alreadyOnList: [], elsewhere: [] });
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
    await pickSoup();
    expect(getPlan).toHaveBeenCalledWith(['soup']);
    await screen.findByText('Estimated cost');
    expect(document.querySelector('.planner-total')!.textContent).toBe('£0.80 of £70.00');
    expect(screen.getByText('£69.20 left')).toBeTruthy();
    expect(screen.getByText('1 item has no price yet, so this is a minimum.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Suggestions' })).getByText('Stew')).toBeTruthy();
    expect(screen.getByText(/Needs 1 extra thing: Beef mince/)).toBeTruthy();
  });

  it('starts with the recipes named in the URL already ticked', async () => {
    render(<MemoryRouter initialEntries={['/planner?recipe=soup&recipe=gone']}><Planner /></MemoryRouter>);
    await waitFor(() => expect((screen.getByLabelText('Carrot soup') as HTMLInputElement).checked).toBe(true));
    expect((screen.getByLabelText('Stew') as HTMLInputElement).checked).toBe(false);
    await screen.findByText('Estimated cost');
    expect(getPlan).toHaveBeenCalledTimes(1);
    expect(getPlan).toHaveBeenCalledWith(['soup']);
  });

  it('warns when over budget', async () => {
    vi.mocked(getPlan).mockResolvedValue(plan({ budgetPence: 50 }));
    view();
    await pickSoup();
    expect(await screen.findByText('£0.30 over budget')).toBeTruthy();
  });

  it('adding a suggestion ticks it and re-plans with both', async () => {
    view();
    await pickSoup();
    await userEvent.click(await screen.findByRole('button', { name: 'Add Stew' }));
    expect(getPlan).toHaveBeenLastCalledWith(['soup', 'stew']);
    expect((screen.getByLabelText('Stew') as HTMLInputElement).checked).toBe(true);
  });

  it('shows which packs to buy, what is needed and what is spare', async () => {
    vi.mocked(getPlan).mockResolvedValue(plan({
      basket: {
        items: [item({
          key: 'onion', item: 'onion', pricePence: 110, needed: 4, leftover: 2,
          picks: [{ label: 'bag of 3', count: 2, pence: 160 }, { label: 'loose', count: 1, pence: 30 }],
        })],
        totalPence: 110, byShop: [{ shop: null, totalPence: 110 }], unpriced: [],
      },
    }));
    view();
    await pickSoup();
    expect(await screen.findByText(/£1\.10 · 2 × bag of 3 \+ 1 × loose/)).toBeTruthy();
    expect(screen.getByText('Needs 4, 2 spare')).toBeTruthy();
  });

  it('says so when some use could not be measured', async () => {
    vi.mocked(getPlan).mockResolvedValue(plan({
      basket: { items: [item({ key: 'onion', item: 'onion', unclear: true })], totalPence: 80, byShop: [{ shop: null, totalPence: 80 }], unpriced: [] },
    }));
    view();
    await pickSoup();
    expect(await screen.findByText(/Some use isn't measured/)).toBeTruthy();
  });

  it('groups items by shop with a subtotal each, and links to set a price', async () => {
    vi.mocked(getPlan).mockResolvedValue(plan({
      basket: {
        items: [item({ key: 'carrot', item: 'carrot' }), item({ key: 'beef shin', item: 'beef shin', shop: 'Butcher', pricePence: 700 }), item({ key: 'stock', item: 'stock', pricePence: null, picks: [] })],
        totalPence: 780, byShop: [{ shop: null, totalPence: 80 }, { shop: 'Butcher', totalPence: 700 }], unpriced: ['stock'],
      },
    }));
    view();
    await pickSoup();
    expect(await screen.findByText('Tesco · £0.80')).toBeTruthy();
    expect(screen.getByText('Butcher · £7.00')).toBeTruthy();
    expect(document.querySelector('.planner-total')!.textContent).toBe('£7.80 of £70.00');
    expect(screen.getByRole('link', { name: 'Set a price for stock' }).getAttribute('href')).toBe('/ingredients?q=stock');
    expect(screen.getByRole('link', { name: 'Edit prices for carrot' })).toBeTruthy();
  });

  it('marks suggested extras that come from another shop', async () => {
    vi.mocked(getPlan).mockResolvedValue(plan({
      suggestions: [{ id: 'x', title: 'Pie', shared: ['carrot'], extra: [{ item: 'beef shin', shop: 'Butcher' }], extraPence: 700, unpricedExtra: [] }],
    }));
    view();
    await pickSoup();
    expect(await screen.findByText(/Beef shin \(Butcher\)/)).toBeTruthy();
  });

  it('saves the budget when the field loses focus', async () => {
    view();
    const box = await screen.findByPlaceholderText('e.g. 70');
    await userEvent.clear(box);
    await userEvent.type(box, '65');
    await userEvent.tab();
    await waitFor(() => expect(saveBudget).toHaveBeenCalledWith(6500));
  });

  it('adds the picked recipes to the shopping list and reports other shops and ones already there', async () => {
    vi.mocked(addPlanToShopping).mockResolvedValue({ added: 0, alreadyOnList: ['Carrot soup'], elsewhere: [{ item: 'beef shin', shop: 'Butcher' }] });
    view();
    await pickSoup();
    await userEvent.click(await screen.findByRole('button', { name: 'Add 1 recipe to shopping list' }));
    expect(addPlanToShopping).toHaveBeenCalledWith(['soup']);
    expect(await screen.findByText(/Sorted by shop: Beef shin \(Butcher\)\. Already on the list: Carrot soup/)).toBeTruthy();
  });
});
