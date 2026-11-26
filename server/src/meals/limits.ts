/**
 * What a stored schedule may hold. The PUT body enforces these and applySchedule clamps a drafted schedule to them,
 * from this one place so the two cannot drift apart: a draft outside the bounds used to store and read back fine and
 * then make every later PUT — every tick, every retime, every drop — answer a bare 400, leaving the meal read-only
 * with nothing on screen to explain it.
 */

/** How many recipes one meal may hold. The picker stops short of it so the route never has to refuse one. */
export const MAX_MEAL_RECIPES = 20;
export const MAX_STAGES = 100;
/** Sixty days in minutes: both how far before serving a stage may start and how long it may last. */
export const MAX_STAGE_MINUTES = 60 * 24 * 60;
export const MAX_STAGE_TEXT = 2000;
export const MAX_STAGE_STEPS = 200;
export const MAX_WATCH_OUT = 50;
export const MAX_WATCH_OUT_TEXT = 500;
