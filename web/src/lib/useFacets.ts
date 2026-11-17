import { useEffect, useState } from 'react';
import { getFacets, type Facets } from '../api';

/** The brands and tags already in use, for the recipe form's suggestions. Only a convenience, so a failure is ignored. */
export function useFacets(): Facets | undefined {
  const [facets, setFacets] = useState<Facets>();
  useEffect(() => {
    let live = true;
    getFacets().then((f) => live && setFacets(f)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return facets;
}
