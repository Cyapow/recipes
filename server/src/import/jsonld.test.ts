import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRecipeJsonLd, findImageUrl } from './jsonld.js';

const fixture = (n: string) => readFileSync(new URL(`../../test-fixtures/${n}`, import.meta.url), 'utf8');
const ld = (obj: unknown) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const recipe = (extra: object = {}) => ({ '@type': 'Recipe', name: 'R', recipeIngredient: ['1 egg'], recipeInstructions: ['Cook.'], ...extra });

describe('parseRecipeJsonLd step links', () => {
  it('links named ingredients per step, keeping flattened HowToSection order', () => {
    const r = parseRecipeJsonLd(ld(recipe({
      recipeIngredient: ['1 onion', '2 tins chopped tomatoes', '1 carrot'],
      recipeInstructions: [
        { '@type': 'HowToSection', name: 'A', itemListElement: [{ '@type': 'HowToStep', text: 'Fry the onions.' }, 'Add the tomatoes.'] },
        { '@type': 'HowToStep', text: 'Serve.' },
      ],
    })))!;
    expect(r.steps).toEqual([
      { text: 'Fry the onions.', imageId: null, ingredients: [0] },
      { text: 'Add the tomatoes.', imageId: null, ingredients: [1] },
      { text: 'Serve.', imageId: null, ingredients: [] },
    ]);
  });
});

describe('parseRecipeJsonLd', () => {
  it('parses a BBC Good Food shaped page (second block is the Recipe)', () => {
    const r = parseRecipeJsonLd(fixture('bbc-goodfood.html'))!;
    expect(r.title).toBe('Easy pancakes');
    expect(r.description).toBe('Make the perfect pancakes & serve with lemon.');
    expect(r.prepMinutes).toBe(10);
    expect(r.cookMinutes).toBe(20);
    expect(r.servings).toBe(4);
    expect(r.origin).toBe('other');
    expect(r.ingredients[0]).toEqual({ group: null, quantity: null, unit: null, item: '100g plain flour', note: null });
    expect(r.ingredients).toHaveLength(4);
    expect(r.steps.map((x) => x.text)).toEqual(['Put the flour, eggs & milk in a bowl and whisk.', 'Heat the oil in a pan.', 'Pour in some batter and cook for 1 min each side.']);
    expect(r.steps.every((x) => x.imageId === null)).toBe(true);
    expect(r.steps.map((x) => x.ingredients)).toEqual([[1, 2], [], []]); // 'plain flour' and 'sunflower oil' need both words
    expect(r.tags).toEqual(['breakfast', 'brunch', 'british', 'pancakes', 'shrove tuesday', 'easy']);
    expect(r.imageIds).toEqual([]);
  });
  it('handles @graph, @type arrays, HowToSection flattening, array yield, P0DT45M, and survives malformed JSON in another block', () => {
    const r = parseRecipeJsonLd(fixture('graph-wrapper.html'))!;
    expect(r.title).toBe('Beef stew');
    expect(r.steps.map((x) => x.text)).toEqual(['Chop.', 'Brown.', 'Simmer.', 'Serve.']);
    expect(r.servings).toBe(6);
    expect(r.prepMinutes).toBe(90);
    expect(r.cookMinutes).toBe(45);
  });
  it('returns null when there is no Recipe', () => {
    expect(parseRecipeJsonLd(fixture('no-recipe.html'))).toBeNull();
    expect(parseRecipeJsonLd('<p>hi</p>')).toBeNull();
  });
  it('parses durations', () => {
    const mins = (d: string) => parseRecipeJsonLd(ld(recipe({ prepTime: d })))!.prepMinutes;
    expect(mins('PT1H30M')).toBe(90);
    expect(mins('PT90M')).toBe(90);
    expect(mins('P0DT45M')).toBe(45);
    expect(mins('P1DT1H')).toBe(1500);
    expect(mins('PT30S')).toBe(1);
    expect(mins('soon')).toBeNull();
  });
  it('parses yield as number, string or array', () => {
    const y = (v: unknown) => parseRecipeJsonLd(ld(recipe({ recipeYield: v })))!.servings;
    expect(y(4)).toBe(4);
    expect(y('Makes 12 cookies')).toBe(12);
    expect(y(['8', '8 servings'])).toBe(8);
    expect(y('a few')).toBeNull();
    expect(y(undefined)).toBeNull();
  });
  it('requires a name and tolerates missing fields without inventing', () => {
    expect(parseRecipeJsonLd(ld({ '@type': 'Recipe' }))).toBeNull();
    const r = parseRecipeJsonLd(ld({ '@type': 'Recipe', name: 'Bare' }))!;
    expect(r).toMatchObject({ servings: null, prepMinutes: null, cookMinutes: null, ingredients: [], steps: [], tags: [], notes: null });
  });
  it('caps and normalises tags', () => {
    const r = parseRecipeJsonLd(ld(recipe({ keywords: Array.from({ length: 20 }, (_, i) => ` Tag${i} `).join(','), recipeCategory: 'Dinner' })))!;
    expect(r.tags).toHaveLength(8);
    expect(r.tags[0]).toBe('dinner');
  });
  it('accepts an array of top-level nodes', () => {
    expect(parseRecipeJsonLd(ld([{ '@type': 'Thing' }, recipe()]))!.title).toBe('R');
  });
});

describe('findImageUrl', () => {
  it('reads string / ImageObject / array images from the recipe', () => {
    for (const image of ['https://x.test/a.jpg', { '@type': 'ImageObject', url: 'https://x.test/a.jpg' }, ['https://x.test/a.jpg', 'https://x.test/b.jpg']]) {
      expect(findImageUrl(ld(recipe({ image })), 'https://x.test/p')).toBe('https://x.test/a.jpg');
    }
  });
  it('falls back to og:image and resolves relative urls', () => {
    expect(findImageUrl('<meta property="og:image" content="/img/p.jpg">', 'https://x.test/a/b')).toBe('https://x.test/img/p.jpg');
    expect(findImageUrl('<p/>', 'https://x.test')).toBeNull();
  });
});
