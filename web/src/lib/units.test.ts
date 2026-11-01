import { describe, expect, it } from 'vitest';
import { convertTemperatures, hasImperial, metricIngredient, metricRecipe, toMetric } from './units';
import type { Ingredient } from '../../../server/src/recipes/schema';

const ing = (quantity: number | null, unit: string | null, item: string): Ingredient =>
  ({ group: null, quantity, unit, item, note: null });
const step = (text: string) => ({ text, imageId: null, ingredients: [] });

const m = (quantity: number, unit: string) => toMetric({ quantity, unit });

describe('toMetric weights', () => {
  it('converts pounds and ounces to the grams a cookbook would print', () => {
    expect(m(1, 'lb')).toEqual({ quantity: 450, unit: 'g' });
    expect(m(2, 'lb')).toEqual({ quantity: 910, unit: 'g' });
    expect(m(8, 'oz')).toEqual({ quantity: 230, unit: 'g' });
    expect(m(4, 'oz')).toEqual({ quantity: 110, unit: 'g' });
    expect(m(1, 'oz')).toEqual({ quantity: 30, unit: 'g' });
  });
  it('keeps a small amount finer, where rounding to ten would be a third of it', () => {
    expect(m(0.5, 'oz')).toEqual({ quantity: 15, unit: 'g' });
  });
  it('moves up to kilos past a kilo', () => {
    expect(m(3, 'lb')).toEqual({ quantity: 1.35, unit: 'kg' });
    expect(m(5, 'lb')).toEqual({ quantity: 2.25, unit: 'kg' });
  });
  it('reads the spelled-out and plural forms', () => {
    for (const u of ['lb', 'lbs', 'Lb', 'pound', 'pounds']) expect(m(1, u)).toEqual({ quantity: 450, unit: 'g' });
    for (const u of ['oz', 'ounce', 'ounces', 'OZ']) expect(m(8, u)).toEqual({ quantity: 230, unit: 'g' });
  });
});

describe('toMetric volumes', () => {
  it('converts fluid ounces, pints, quarts and gallons', () => {
    expect(m(1, 'fl oz')).toEqual({ quantity: 30, unit: 'ml' });
    expect(m(1, 'pint')).toEqual({ quantity: 470, unit: 'ml' });
    expect(m(1, 'quart')).toEqual({ quantity: 950, unit: 'ml' });
    expect(m(1, 'gallon')).toEqual({ quantity: 3.8, unit: 'l' });
  });
});

describe('toMetric leaves alone what you can already measure', () => {
  it('says nothing about cups, spoons, metric units and countable things', () => {
    for (const u of ['cup', 'cups', 'tbsp', 'tablespoon', 'tsp', 'g', 'kg', 'ml', 'l', 'clove', 'cloves', 'tin', 'stick', 'sticks', 'handful']) {
      expect(toMetric({ quantity: 2, unit: u })).toBeNull();
    }
  });
  it('says nothing without both a quantity and a unit', () => {
    expect(toMetric({ quantity: null, unit: 'lb' })).toBeNull();
    expect(toMetric({ quantity: 2, unit: null })).toBeNull();
    expect(toMetric({ quantity: 0, unit: 'lb' })).toBeNull();
  });
});

describe('convertTemperatures', () => {
  it('converts a Fahrenheit oven to the nearest ten degrees', () => {
    expect(convertTemperatures('Fry at 350°F until golden')).toBe('Fry at 180°C until golden');
    expect(convertTemperatures('Bake at 425 F')).toBe('Bake at 220°C');
    expect(convertTemperatures('Heat to 400 degrees F, then rest')).toBe('Heat to 200°C, then rest');
  });
  it('leaves a Fahrenheit figure alone when the recipe already gives the Celsius', () => {
    expect(convertTemperatures('Preheat the oven to 170°C/325°F (fan).')).toBe('Preheat the oven to 170°C/325°F (fan).');
    expect(convertTemperatures('turn the oven up to 200°C/400°F (fan)')).toBe('turn the oven up to 200°C/400°F (fan)');
    expect(convertTemperatures('Set it to 180C (350F).')).toBe('Set it to 180C (350F).');
  });
  it('leaves text with no temperature in it untouched', () => {
    expect(convertTemperatures('Fold in the sides of the tortilla.')).toBe('Fold in the sides of the tortilla.');
    expect(convertTemperatures('Cook for 3 to 4 minutes.')).toBe('Cook for 3 to 4 minutes.');
  });
  it('does not mistake a stray F for a temperature', () => {
    expect(convertTemperatures('Add 2 F plates')).toBe('Add 2 F plates');
    expect(convertTemperatures('Fry for 5 minutes')).toBe('Fry for 5 minutes');
  });
});

describe('metricIngredient', () => {
  it('swaps the amount and leaves the rest of the line as it was', () => {
    expect(metricIngredient(ing(1, 'lb', 'ground beef'))).toEqual({ group: null, quantity: 450, unit: 'g', item: 'ground beef', note: null });
  });
  it('hands back the very same ingredient when there is nothing to convert', () => {
    const cups = ing(2, 'cups', 'flour');
    expect(metricIngredient(cups)).toBe(cups);
  });
});

describe('hasImperial', () => {
  it('is true when a recipe has an amount or a temperature worth converting', () => {
    expect(hasImperial([ing(1, 'lb', 'beef')], [step('Cook it.')])).toBe(true);
    expect(hasImperial([ing(500, 'g', 'beef')], [step('Fry at 350°F.')])).toBe(true);
  });
  it('is false for a recipe already written the way we cook', () => {
    expect(hasImperial([ing(500, 'g', 'beef'), ing(2, 'cups', 'flour')], [step('Bake at 180°C.')])).toBe(false);
    expect(hasImperial([], [])).toBe(false);
  });
  it('is false when the only Fahrenheit already has its Celsius beside it', () => {
    expect(hasImperial([ing(500, 'g', 'beef')], [step('Preheat to 170°C/325°F (fan).')])).toBe(false);
  });
});

describe('metricRecipe', () => {
  it('converts the amounts and the step temperatures in one pass, keeping the step links', () => {
    const r = {
      ingredients: [ing(1, 'lb', 'ground beef'), ing(2, 'cups', 'flour')],
      steps: [{ text: 'Fry at 350°F.', imageId: null, ingredients: [0] }],
    };
    expect(metricRecipe(r)).toEqual({
      ingredients: [ing(450, 'g', 'ground beef'), ing(2, 'cups', 'flour')],
      steps: [{ text: 'Fry at 180°C.', imageId: null, ingredients: [0] }],
    });
  });
});
