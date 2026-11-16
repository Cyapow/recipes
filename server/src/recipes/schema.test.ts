import { describe, expect, it } from 'vitest';
import { RecipeDraftSchema, RecipeInputSchema, normaliseSteps } from './schema.js';

describe('normaliseSteps', () => {
  it('converts strings, dedupes/sorts links and drops invalid ones', () => {
    expect(
      normaliseSteps(['a', { text: 'b', imageId: null, ingredients: [2, 0, 2, 9, -1, 1.5] }], 3),
    ).toEqual([
      { text: 'a', imageId: null, ingredients: [] },
      { text: 'b', imageId: null, ingredients: [0, 2] },
    ]);
    expect(normaliseSteps('nope', 3)).toEqual([]);
  });
});

describe('(g) RecipeDraftSchema', () => {
  it('still exists, takes Step objects and converts to JSON schema', async () => {
    const { z } = await import('zod');
    const draft = {
      title: 't', description: null, origin: 'mine', sourceName: null, sourceUrl: null, servings: null,
      prepMinutes: null, cookMinutes: null, ingredients: [], steps: [{ text: 's', imageId: null, ingredients: [] }],
      notes: null, brand: null, tags: [], imageIds: [], gaps: [],
    };
    expect(RecipeDraftSchema.safeParse(draft).success).toBe(true);
    expect(() => z.toJSONSchema(RecipeDraftSchema)).not.toThrow();
    expect(RecipeInputSchema.safeParse({ ...draft, steps: ['s'] }).success).toBe(true);
  });
});

describe('RecipeInputSchema brand and tags', () => {
  const input = {
    title: 't', description: null, origin: 'mine', sourceName: null, sourceUrl: null, servings: null,
    prepMinutes: null, cookMinutes: null, ingredients: [], steps: [], notes: null, tags: [], imageIds: [],
  };
  it('accepts legacy string tags and derives brand from origin when brand is absent', () => {
    const r = RecipeInputSchema.parse({ ...input, tags: ['pasta'] });
    expect(r.brand).toBe('Mine');
    expect(r.origin).toBe('mine');
    expect(r.tags).toEqual([{ group: 'other', name: 'pasta' }]);
    expect(RecipeInputSchema.parse({ ...input, origin: 'other' }).brand).toBeNull();
  });
  it('lets a present brand decide origin', () => {
    expect(RecipeInputSchema.parse({ ...input, brand: 'gousto' })).toMatchObject({ brand: 'Gousto', origin: 'other' });
    expect(RecipeInputSchema.parse({ ...input, brand: null })).toMatchObject({ brand: null, origin: 'other' });
    expect(RecipeInputSchema.parse({ ...input, origin: 'other', brand: ' mine ' })).toMatchObject({ brand: 'Mine', origin: 'mine' });
  });
});
