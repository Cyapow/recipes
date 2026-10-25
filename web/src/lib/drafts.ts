import { useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { RecipeInput } from '../api';

export type DraftKind = 'new' | 'edit' | 'describe' | 'import';

/** Work in progress kept on this device so a refresh or an accidental navigation does not lose it. */
export type Draft = {
  id: string;
  kind: DraftKind;
  /** Set for 'edit': the recipe being edited. */
  recipeId?: string;
  savedAt: number;
  /** The form contents. */
  input?: RecipeInput;
  /** "Check these" notes from the AI, kept with the form. */
  gaps?: string[];
  /** Describe: what the user typed. */
  text?: string;
  /** Import: the page address. */
  url?: string;
};

const KEY = 'recipes.drafts';
const MAX = 20;

function read(): Draft[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as Draft[]).filter((d) => d && typeof d.id === 'string' && typeof d.kind === 'string') : [];
  } catch {
    return [];
  }
}

function write(list: Draft[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // storage full or blocked: drafts are a convenience, never an error
  }
}

/** Newest first. */
export function listDrafts(): Draft[] {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

export const getDraft = (id: string): Draft | null => read().find((d) => d.id === id) ?? null;

export function putDraft(draft: Draft): void {
  write([draft, ...read().filter((d) => d.id !== draft.id)]);
}

export function removeDraft(id: string): void {
  write(read().filter((d) => d.id !== id));
}

function hostOf(url?: string): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return url?.trim() ?? '';
  }
}

/** What to call a draft in a list. */
export function draftTitle(d: Draft): string {
  const t = d.input?.title?.trim() || d.text?.trim().slice(0, 40) || hostOf(d.url) || '';
  return t || 'Untitled recipe';
}

export const draftKindLabel = (k: DraftKind): string =>
  k === 'edit' ? 'Editing' : k === 'describe' ? 'Described' : k === 'import' ? 'Imported' : 'New';

/** Where Resume goes. */
export function draftHref(d: Draft): string {
  const q = `?draft=${encodeURIComponent(d.id)}`;
  return d.kind === 'edit' && d.recipeId
    ? `/recipe/${encodeURIComponent(d.recipeId)}/edit${q}`
    : d.kind === 'describe'
      ? `/describe${q}`
      : d.kind === 'import'
        ? `/import${q}`
        : `/new${q}`;
}

const newId = (): string => globalThis.crypto?.randomUUID?.() ?? `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * The draft for the current page: the one named by `?draft=` when resuming, otherwise a fresh id.
 * After `clear()` (the recipe was saved) further `save()` calls do nothing, so a late debounced save cannot bring it back.
 */
export function useDraft(kind: DraftKind, recipeId?: string) {
  const [params] = useSearchParams();
  const resumeId = params.get('draft');
  const existing = useMemo(() => {
    const d = resumeId ? getDraft(resumeId) : null;
    return d && d.kind === kind && (kind !== 'edit' || d.recipeId === recipeId) ? d : null;
  }, [resumeId, kind, recipeId]);
  const id = useRef(existing?.id ?? newId());
  const cleared = useRef(false);
  const save = useCallback(
    (patch: Partial<Draft>) => {
      if (cleared.current) return;
      const base = getDraft(id.current) ?? { id: id.current, kind, recipeId, savedAt: 0 };
      putDraft({ ...base, ...patch, id: id.current, kind, recipeId, savedAt: Date.now() });
    },
    [kind, recipeId],
  );
  const clear = useCallback(() => {
    cleared.current = true;
    removeDraft(id.current);
  }, []);
  return { existing, save, clear };
}
