CREATE TABLE meals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  serve_at TEXT NOT NULL,
  watch_out_json TEXT,
  schedule_stale INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- recipe_id is nullable and SET NULL so deleting a recipe never refuses and never damages a meal;
-- recipe_title is a snapshot so the meal still reads afterwards.
CREATE TABLE meal_recipes (
  id TEXT PRIMARY KEY,
  meal_id TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  recipe_title TEXT NOT NULL,
  course TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE UNIQUE INDEX meal_recipes_unique ON meal_recipes (meal_id, recipe_id) WHERE recipe_id IS NOT NULL;
CREATE INDEX meal_recipes_recipe ON meal_recipes (recipe_id);

-- A stage holds its own text; recipe_id and step_indices_json are only a back-reference.
-- offset_minutes counts back from serving: 0 is serving, 120 is two hours before.
CREATE TABLE meal_stages (
  id TEXT PRIMARY KEY,
  meal_id TEXT NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  offset_minutes INTEGER NOT NULL,
  duration_minutes INTEGER,
  estimated INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  step_indices_json TEXT,
  done_at TEXT,
  position INTEGER NOT NULL
);

CREATE INDEX meal_stages_meal ON meal_stages (meal_id, position);
CREATE INDEX meal_stages_recipe ON meal_stages (recipe_id);
