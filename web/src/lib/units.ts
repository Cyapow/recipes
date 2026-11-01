/**
 * Imperial amounts shown in metric, for recipes written for an American kitchen.
 *
 * Only the units you cannot measure at home are converted. Cups, tablespoons and teaspoons are left exactly as
 * written: a cup is a volume that American recipes use for solids, so a cup of flour is 120g and a cup of sugar
 * 200g, and there is no honest conversion without knowing what is in it. We own measuring cups and spoons.
 *
 * US gallons and pints throughout, since a recipe in pounds and ounces is an American one. A UK pint is 568ml.
 */

import type { Ingredient, Step } from '../../../server/src/recipes/schema';

export type Amount = { quantity: number | null; unit: string | null };

/** Grams or millilitres per unit, exact. The rounding below is what makes the result printable. */
const FACTORS: Record<string, { per: number; unit: 'g' | 'ml' }> = {
  lb: { per: 453.59237, unit: 'g' },
  lbs: { per: 453.59237, unit: 'g' },
  pound: { per: 453.59237, unit: 'g' },
  pounds: { per: 453.59237, unit: 'g' },
  oz: { per: 28.349523, unit: 'g' },
  ounce: { per: 28.349523, unit: 'g' },
  ounces: { per: 28.349523, unit: 'g' },
  'fl oz': { per: 29.57353, unit: 'ml' },
  'floz': { per: 29.57353, unit: 'ml' },
  'fluid ounce': { per: 29.57353, unit: 'ml' },
  'fluid ounces': { per: 29.57353, unit: 'ml' },
  pint: { per: 473.17647, unit: 'ml' },
  pints: { per: 473.17647, unit: 'ml' },
  quart: { per: 946.35295, unit: 'ml' },
  quarts: { per: 946.35295, unit: 'ml' },
  gallon: { per: 3785.4118, unit: 'ml' },
  gallons: { per: 3785.4118, unit: 'ml' },
};

/**
 * A number a cook can work to. Rounding to ten throughout would make half an ounce 10g, a third out, so small
 * amounts stay finer; past a kilo the tens stop meaning anything, so it goes to fifties and up to kg or l.
 */
function round(value: number): number {
  if (value < 50) return Math.round(value / 5) * 5;
  if (value < 1000) return Math.round(value / 10) * 10;
  return Math.round(value / 50) * 50;
}

/** The metric equivalent of an amount, or null when it is already metric or not worth converting. */
export function toMetric(a: Amount): Amount | null {
  if (a.quantity == null || a.quantity <= 0 || a.unit == null) return null;
  const f = FACTORS[a.unit.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ')];
  if (!f) return null;
  const total = round(a.quantity * f.per);
  if (total < 1000) return { quantity: total, unit: f.unit };
  // Past a kilo or a litre, two decimals is as fine as the fifties above can be.
  return { quantity: Math.round(total / 10) / 100, unit: f.unit === 'g' ? 'kg' : 'l' };
}

// "350°F", "425 F", "400 degrees F", "350 Fahrenheit". Two or three digits and a word boundary after the F, so
// neither a stray F ("add 2 F plates") nor a following word ("350 Fry for") is read as a temperature.
const FAHRENHEIT = /(\d{2,3})\s*(?:°\s*F|degrees?\s*F|fahrenheit|F)\b/gi;
// A Celsius figure already given just before it, as in "170°C/325°F": converting that would say "170°C/160°C".
const CELSIUS_BEFORE = /\d{2,3}\s*(?:°\s*C|degrees?\s*C|celsius|C)\b[^\d]{0,4}$/i;

/** Fahrenheit oven temperatures in a step, in Celsius to the nearest ten, which is what an oven dial is marked in. */
export function convertTemperatures(text: string): string {
  return text.replace(FAHRENHEIT, (whole, degrees: string, offset: number) => {
    if (CELSIUS_BEFORE.test(text.slice(Math.max(0, offset - 24), offset))) return whole;
    const c = Math.round(((Number(degrees) - 32) * 5) / 9 / 10) * 10;
    return `${c}°C`;
  });
}

/** The same ingredient with a metric amount, or the ingredient itself when there is nothing to convert. */
export function metricIngredient(i: Ingredient): Ingredient {
  const metric = toMetric(i);
  return metric ? { ...i, quantity: metric.quantity, unit: metric.unit } : i;
}

/** Whether showing this recipe in metric would change anything, so a recipe already in metric offers no toggle. */
export function hasImperial(ingredients: Ingredient[], steps: Step[]): boolean {
  return ingredients.some((i) => toMetric(i) !== null) || steps.some((s) => convertTemperatures(s.text) !== s.text);
}

/**
 * A whole recipe shown in metric: amounts converted, Fahrenheit temperatures in the steps converted, everything
 * else untouched. One pass over the recipe rather than a conversion at each place it is displayed.
 */
export function metricRecipe<T extends { ingredients: Ingredient[]; steps: Step[] }>(r: T): T {
  return {
    ...r,
    ingredients: r.ingredients.map(metricIngredient),
    steps: r.steps.map((s) => ({ ...s, text: convertTemperatures(s.text) })),
  };
}
