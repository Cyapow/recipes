import type { RecipeSummary } from '../api';
import { formatMinutes, originLabel } from '../lib/text';
import { monogram, monogramColors } from '../lib/monogram';

/** What a recipe says about itself in one line of a list: where it came from, what kind it is, how long it takes. */
export function subtitle(r: RecipeSummary): string {
  return [originLabel(r), r.tags[0]?.name, formatMinutes(r.totalMinutes)].filter(Boolean).join(' · ');
}

/**
 * How a recipe appears in a list: its photo, or a monogram tile when it has none, beside its title and subtitle.
 * The library and the meal picker both show it, so a recipe looks the same whether you are reading or choosing.
 */
export function RecipeFace({ recipe }: { recipe: RecipeSummary }) {
  return (
    <>
      {recipe.thumbnailId ? (
        <span className="thumb"><img src={`/api/images/${recipe.thumbnailId}/thumb`} alt="" /></span>
      ) : (
        <span className="thumb" aria-hidden="true" style={{ background: monogramColors(recipe.title).bg, color: monogramColors(recipe.title).fg }}>
          {monogram(recipe.title)}
        </span>
      )}
      <span className="meta">
        <span className="title">{recipe.title}</span>
        <span className="sub">{subtitle(recipe)}</span>
      </span>
    </>
  );
}
