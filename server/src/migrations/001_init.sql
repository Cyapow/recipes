CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  origin TEXT NOT NULL CHECK (origin IN ('mine', 'other')),
  source_name TEXT,
  source_url TEXT,
  servings REAL,
  prep_minutes INTEGER,
  cook_minutes INTEGER,
  notes TEXT,
  ingredients_json TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  image_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
