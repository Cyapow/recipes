// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Ingredients } from './Ingredients';

vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  listIngredients: vi.fn(), saveIngredient: vi.fn(), removeIngredient: vi.fn(), addShop: vi.fn(), renameShop: vi.fn(), deleteShop: vi.fn(),
}));
import { addShop, deleteShop, listIngredients, removeIngredient, saveIngredient } from '../api';

const SHOPS = [{ id: 'tesco', name: 'Tesco', position: 1 }, { id: 'butcher', name: 'Butcher', position: 2 }];
const ROWS = [
  { key: 'beef shin', item: 'beef shin', recipeCount: 1, usualUnit: 'g', shopId: null, unit: 'g', packs: [] },
  { key: 'onion', item: 'onion', recipeCount: 3, usualUnit: '', shopId: null, unit: '',
    packs: [{ label: 'loose', amount: 1, pricePence: 30, clubcardPence: null }, { label: 'bag of 3', amount: 3, pricePence: 100, clubcardPence: 80 }] },
];

const view = (url = '/ingredients') => render(<MemoryRouter initialEntries={[url]}><Ingredients /></MemoryRouter>);
const open = async (name: RegExp) => userEvent.click(await screen.findByRole('button', { name }));

beforeEach(() => {
  vi.mocked(listIngredients).mockReset().mockResolvedValue({ ingredients: ROWS, shops: SHOPS });
  vi.mocked(saveIngredient).mockReset().mockResolvedValue(undefined);
  vi.mocked(removeIngredient).mockReset().mockResolvedValue(undefined);
  vi.mocked(addShop).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteShop).mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('Ingredients', () => {
  it('lists every ingredient with a summary of its price', async () => {
    view();
    expect(await screen.findByText('2 pack sizes · in 3 recipes')).toBeTruthy();
    expect(screen.getByText('No price yet · in 1 recipe')).toBeTruthy();
  });

  it('filters by search text and by "no price yet"', async () => {
    view('/ingredients?q=oni');
    await screen.findByText('Onion');
    expect(screen.queryByText('Beef shin')).toBeNull();
    cleanup();
    view();
    await userEvent.click(await screen.findByLabelText(/Only ones with no price yet \(1\)/));
    expect(screen.queryByText('Onion')).toBeNull();
    expect(screen.getByText('Beef shin')).toBeTruthy();
  });

  it('saves a shop, a unit and several pack sizes, and turns 1kg into grams', async () => {
    view();
    await open(/Beef shin/);
    await userEvent.selectOptions(screen.getByLabelText('Bought from'), 'butcher');
    await userEvent.type(screen.getByLabelText('Pack 1 name'), 'per kg');
    await userEvent.type(screen.getByLabelText('Pack 1 covers'), '1kg');
    await userEvent.type(screen.getByLabelText('Pack 1 price'), '11');
    await userEvent.click(screen.getByRole('button', { name: 'Add another pack size' }));
    await userEvent.type(screen.getByLabelText('Pack 2 covers'), '500');
    await userEvent.type(screen.getByLabelText('Pack 2 price'), '6.50');
    await userEvent.type(screen.getByLabelText('Pack 2 Clubcard price'), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveIngredient).toHaveBeenCalledWith({
      item: 'beef shin', shopId: 'butcher', unit: 'g',
      packs: [
        { label: 'per kg', amount: 1000, pricePence: 1100, clubcardPence: null },
        { label: '', amount: 500, pricePence: 650, clubcardPence: 600 },
      ],
    }));
  });

  it('shows existing packs for editing', async () => {
    view();
    await open(/Onion/);
    expect((screen.getByLabelText('Pack 2 name') as HTMLInputElement).value).toBe('bag of 3');
    expect((screen.getByLabelText('Pack 2 price') as HTMLInputElement).value).toBe('1.00');
    expect((screen.getByLabelText('Pack 2 Clubcard price') as HTMLInputElement).value).toBe('0.80');
  });

  it('leaves "covers" empty to mean any amount', async () => {
    view();
    await open(/Beef shin/);
    await userEvent.type(screen.getByLabelText('Pack 1 price'), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveIngredient).toHaveBeenCalledWith(expect.objectContaining({
      packs: [{ label: '', amount: null, pricePence: 400, clubcardPence: null }],
    })));
  });

  it('refuses bad prices, sizes and Clubcard prices without calling the server', async () => {
    view();
    await open(/Beef shin/);
    await userEvent.type(screen.getByLabelText('Pack 1 price'), 'lots');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Pack 1: enter a price like 1.50')).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Pack 1 price'));
    await userEvent.type(screen.getByLabelText('Pack 1 price'), '2');
    await userEvent.type(screen.getByLabelText('Pack 1 covers'), 'loads');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Pack 1: "covers" should be a number like 500 or 1kg/)).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Pack 1 covers'));
    await userEvent.type(screen.getByLabelText('Pack 1 Clubcard price'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Clubcard price is higher/)).toBeTruthy();
    expect(saveIngredient).not.toHaveBeenCalled();
  });

  it('forgets prices', async () => {
    view();
    await open(/Onion/);
    await userEvent.click(screen.getByRole('button', { name: 'Forget prices' }));
    await waitFor(() => expect(removeIngredient).toHaveBeenCalledWith('onion'));
  });

  it('adds and removes shops', async () => {
    view();
    await userEvent.click(await screen.findByText(/^Shops \(/));
    await userEvent.type(screen.getByLabelText('New shop'), 'Aldi');
    await userEvent.click(screen.getByRole('button', { name: 'Add shop' }));
    await waitFor(() => expect(addShop).toHaveBeenCalledWith('Aldi'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Butcher' }));
    await waitFor(() => expect(deleteShop).toHaveBeenCalledWith('butcher'));
  });
});
