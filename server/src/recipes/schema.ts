import { z } from 'zod';

export const IngredientSchema = z.object({
  group: z.string().nullable(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  item: z.string(),
  note: z.string().nullable(),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const RecipeInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  origin: z.enum(['mine', 'other']),
  sourceName: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  servings: z.number().nullable(),
  prepMinutes: z.number().nullable(),
  cookMinutes: z.number().nullable(),
  ingredients: z.array(IngredientSchema),
  steps: z.array(z.string()),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  imageIds: z.array(z.string()),
});
export type RecipeInput = z.infer<typeof RecipeInputSchema>;

export const RecipeSchema = RecipeInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const RecipeDraftSchema = RecipeInputSchema.extend({
  gaps: z.array(z.string()),
});
export type RecipeDraft = z.infer<typeof RecipeDraftSchema>;

export type RecipeSummary = {
  id: string;
  title: string;
  origin: 'mine' | 'other';
  sourceName: string | null;
  tags: string[];
  thumbnailId: string | null;
  totalMinutes: number | null;
};
