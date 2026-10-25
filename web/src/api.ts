import type { Recipe, RecipeDraft, RecipeInput, RecipeSummary } from '../../server/src/recipes/schema';

export type { Recipe, RecipeDraft, RecipeInput, RecipeSummary };

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

export async function uploadImage(file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/images', { method: 'POST', body });
  if (res.status === 413) throw new Error('image is too large (15 MB max)');
  if (res.status === 415) throw new Error('not a supported image');
  if (!res.ok) throw new Error(`upload failed (${res.status})`);
  return ((await res.json()) as { id: string }).id;
}

export async function describeRecipe(text: string): Promise<RecipeDraft> {
  const res = await fetch('/api/ai/describe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as RecipeDraft;
}

export type ImportResult = { draft: RecipeDraft; usedAi: boolean; usable: boolean };

export async function importRecipe(url: string): Promise<ImportResult> {
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as ImportResult;
}
