import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getRecipe, type Recipe } from '../api';
import { qrModules, qrPathData } from '../lib/qr';
import { sourceLink } from '../lib/source';
import { useMetric } from '../lib/metric';
import { formatAmount, formatMinutes, formatQuantity } from '../lib/text';
import { metricRecipe } from '../lib/units';

/** A QR code drawn as one path, sized by CSS. The label is what a scanner would open. */
function Qr({ url }: { url: string }) {
  const modules = qrModules(url);
  return (
    <svg className="qr" viewBox={`0 0 ${modules.length} ${modules.length}`} role="img" aria-label={`Scan to open ${url}`}>
      <path d={qrPathData(modules)} fill="currentColor" />
    </svg>
  );
}

function metaLine(r: Recipe): string {
  return [
    r.servings != null && `${formatQuantity(r.servings)} ${r.servings === 1 ? 'serving' : 'servings'}`,
    formatMinutes(r.prepMinutes) && `Prep ${formatMinutes(r.prepMinutes)}`,
    formatMinutes(r.cookMinutes) && `Cook ${formatMinutes(r.cookMinutes)}`,
  ].filter(Boolean).join(' · ');
}

/**
 * The recipe as it goes on paper: A4 landscape, the photo on its own side and the cooking side holding the
 * ingredients once down the left with the method beside them. Printing is the browser's own, so what is on
 * screen here is what comes out of the printer.
 */
export function PrintCard() {
  const { id = '' } = useParams();
  const [raw, setRecipe] = useState<Recipe | null>(null);
  const [metric] = useMetric();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getRecipe(id)
      .then((r) => live && setRecipe(r))
      .catch(() => live && setError('Could not load recipe'));
    return () => {
      live = false;
    };
  }, [id]);

  if (error) {
    return (
      <main className="page">
        <p className="field-error" role="alert">{error}</p>
        <Link className="btn" to="/">Back to library</Link>
      </main>
    );
  }
  if (!raw) return <main className="page"><p className="empty">Loading…</p></main>;

  // Paper cannot be toggled, so the card prints whichever way the switch was left on the recipe page.
  const recipe = metric ? metricRecipe(raw) : raw;

  const url = `${window.location.origin}/recipe/${encodeURIComponent(recipe.id)}`;
  const meta = metaLine(recipe);
  const image = recipe.imageIds[0];
  const source = sourceLink(recipe);
  let group: string | null = null;

  return (
    <main className="print-view">
      <div className="print-bar">
        <Link className="btn" to={`/recipe/${encodeURIComponent(recipe.id)}`}>Back</Link>
        <p className="hint">Print double-sided on A4, landscape.</p>
        <button type="button" className="primary" onClick={() => window.print()}>Print</button>
      </div>

      {image && (
        <section className="sheet photo-sheet" data-testid="photo-page">
          <img src={`/api/images/${image}`} alt={recipe.title} />
          <div className="photo-band">
            <div>
              <h1>{recipe.title}</h1>
              <p className="card-meta">{meta}</p>
              {recipe.description && <p className="card-desc">{recipe.description}</p>}
            </div>
            <div className="qr-block"><Qr url={url} /><span>Scan for this recipe<br />{window.location.host}</span></div>
          </div>
        </section>
      )}

      <section className="sheet recipe-sheet">
        <header>
          <h1>{recipe.title}</h1>
          <p className="card-meta">{meta}</p>
        </header>
        <div className="card-body">
          <div className="card-left">
            <h2>Ingredients</h2>
            <ul className="card-ingredients" aria-label="Ingredients">
              {recipe.ingredients.map((ing, i) => {
                const heading = ing.group !== group ? ing.group : null;
                group = ing.group;
                const amount = formatAmount(ing);
                return (
                  <Fragment key={i}>
                    {heading && <li className="card-group">{heading}</li>}
                    <li>
                      {amount && <b>{amount}</b>}
                      <span>{ing.item}{ing.note ? ` (${ing.note})` : ''}</span>
                    </li>
                  </Fragment>
                );
              })}
            </ul>
            {recipe.notes && (
              <>
                <h2>Notes</h2>
                <p className="card-notes">{recipe.notes}</p>
              </>
            )}
            {!image && <div className="qr-block"><Qr url={url} /><span>Scan for this recipe<br />{window.location.host}</span></div>}
          </div>
          <div className="card-right">
            <h2>Method</h2>
            <ol className="card-steps" aria-label="Method">
              {recipe.steps.map((step, i) => (
                <li key={i}>
                  <b>{i + 1}</b>
                  {step.imageId && <img src={`/api/images/${step.imageId}`} alt="" />}
                  {step.text}
                </li>
              ))}
            </ol>
          </div>
        </div>
        <footer>
          <span>{source ? `From ${recipe.sourceName ?? source.host}` : 'My recipe'}</span>
          <span>{window.location.host}</span>
        </footer>
      </section>
    </main>
  );
}
