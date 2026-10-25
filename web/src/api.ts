import type { Recipe, RecipeInput, RecipeSummary } from '../../server/src/recipes/schema';

export type { Recipe, RecipeInput, RecipeSummary };

export type ListQuery = { search?: string; origin?: 'mine' | 'other'; tag?: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export function listRecipes(q: ListQuery = {}): Promise<RecipeSummary[]> {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  if (q.origin) p.set('origin', q.origin);
  if (q.tag) p.set('tag', q.tag);
  const qs = p.toString();
  return request(`/api/recipes${qs ? `?${qs}` : ''}`);
}

export const getRecipe = (id: string): Promise<Recipe> => request(`/api/recipes/${encodeURIComponent(id)}`);

export function saveRecipe(id: string | null, input: RecipeInput): Promise<Recipe> {
  return request(id ? `/api/recipes/${encodeURIComponent(id)}` : '/api/recipes', {
    method: id ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export const deleteRecipe = (id: string): Promise<void> =>
  request(`/api/recipes/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const listTags = (): Promise<string[]> => request('/api/tags');
