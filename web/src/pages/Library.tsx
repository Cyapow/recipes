import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBackupStatus, setFavourite, type BackupStatus, type RecipeSummary } from '../api';
import { FavouriteButton } from '../components/FavouriteButton';
import { RecipeBrowser, type RowPatch } from '../components/RecipeBrowser';
import { RecipeFace } from '../components/RecipeFace';
import { BackupBanner } from '../components/BackupBanner';
import { CalendarIcon, CameraIcon, CartIcon, ChevronIcon, GearIcon, LinkIcon, ListIcon, MoreIcon, PlusIcon, SparklesIcon } from '../components/Icons';
import { MoreSheet, type MoreItem } from '../components/MoreSheet';
import { useMe } from '../lib/me';
import { withStar } from '../lib/favourite';
import { draftHref, draftKindLabel, draftTitle, listDrafts, removeDraft, type Draft } from '../lib/drafts';

/** Where the library's filters live between visits. Named so a test can ask for what the page actually uses. */
export const LIBRARY_FILTERS_KEY = 'recipes.libraryFilters';

/**
 * Everything the top bar has no room for. New recipe and the shopping list stay on the bar: one is how the library
 * grows, the other is the thing you open standing in a shop. Planning happens sitting down, so it can afford a tap.
 */
const MORE: MoreItem[] = [
  { to: '/meals', label: 'Meals', icon: <CalendarIcon /> },
  { to: '/planner', label: 'Meal planner', icon: <ListIcon /> },
  { to: '/settings', label: 'Settings', icon: <GearIcon /> },
];

export function Library() {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [backupFailed, setBackupFailed] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>(() => listDrafts());
  const me = useMe()?.email;
  const [starFailed, setStarFailed] = useState(false);

  useEffect(() => {
    getBackupStatus().then(setBackup).catch(() => setBackupFailed(true));
  }, []);

  // Patched in place by the browser: a star is not an edit, so the list neither reloads nor re-sorts under the finger.
  const star = async (r: RecipeSummary, on: boolean, patch: RowPatch) => {
    if (!me) return;
    setStarFailed(false);
    patch({ favouritedBy: withStar(r.favouritedBy, me, on) });
    try {
      await setFavourite(r.id, on);
    } catch {
      patch({ favouritedBy: withStar(r.favouritedBy, me, !on) });
      setStarFailed(true);
    }
  };

  const closeMore = () => {
    setMoreOpen(false);
    moreBtn.current?.focus();
  };

  return (
    <main className="page">
      <header className="bar">
        <h1 className="library-title">Recipes</h1>
        <nav className="actions">
          <Link className="btn icon-btn" to="/new" aria-label="New recipe"><PlusIcon /></Link>
          <Link className="btn icon-btn" to="/shopping" aria-label="Shopping list"><CartIcon /></Link>
          <button
            ref={moreBtn}
            type="button"
            className="btn icon-btn"
            aria-label="More"
            aria-haspopup="dialog"
            onClick={() => setMoreOpen(true)}
          >
            <MoreIcon />
          </button>
        </nav>
      </header>
      <MoreSheet open={moreOpen} items={MORE} onClose={closeMore} />
      {backup && <BackupBanner banner={backup.banner} lastError={backup.lastError} />}
      {backupFailed && <p className="hint" role="status">Couldn't check backup status</p>}
      <RecipeBrowser
        storageKey={LIBRARY_FILTERS_KEY}
        afterSearch={
          <div className="cta-row">
            <Link className="btn cta primary" to="/describe"><SparklesIcon />Describe it</Link>
            <Link className="btn cta outline" to="/import"><LinkIcon />From a link</Link>
            <Link className="btn cta outline" to="/photos"><CameraIcon />From photos</Link>
          </div>
        }
        beforeList={
          <>
            {drafts.length > 0 && (
              <section className="drafts" aria-label="Drafts">
                <h2>Drafts</h2>
                <ul className="rows">
                  {drafts.map((d) => (
                    <li key={d.id} className="draft-card">
                      <span className="meta">
                        <span className="title">{draftTitle(d)}</span>
                        <span className="sub">{draftKindLabel(d.kind)} · {new Date(d.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      </span>
                      <span className="draft-actions">
                        <Link className="btn small primary" to={draftHref(d)} aria-label={`Resume draft ${draftTitle(d)}`}>Resume</Link>
                        <button
                          type="button"
                          className="btn small danger-text"
                          aria-label={`Discard draft ${draftTitle(d)}`}
                          onClick={() => {
                            if (!window.confirm('Discard this draft?')) return;
                            removeDraft(d.id);
                            setDrafts(listDrafts());
                          }}
                        >
                          Discard
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {starFailed && <p className="field-error" role="alert">Couldn't save that favourite. Try again.</p>}
          </>
        }
        renderRow={(r, patch) => (
          <li key={r.id} className="row-item">
            <Link className="row" to={`/recipe/${r.id}`}>
              <RecipeFace recipe={r} />
              <ChevronIcon />
            </Link>
            {me && (
              <FavouriteButton className="row-fav" title={r.title} on={r.favouritedBy.includes(me)} onToggle={() => star(r, !r.favouritedBy.includes(me), patch)} />
            )}
          </li>
        )}
      />
    </main>
  );
}
