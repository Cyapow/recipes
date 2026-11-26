/**
 * What a recipe is in a meal. Its own module, like categories.ts, because the browser needs the list to offer it and
 * must not pull a database repository into the bundle for one constant.
 */
export const COURSES = ['starter', 'main', 'side', 'dessert', 'other'] as const;
export type Course = (typeof COURSES)[number];
