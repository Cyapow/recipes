CREATE TABLE favourites (
  email TEXT NOT NULL,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (email, recipe_id)
);

CREATE INDEX favourites_recipe ON favourites (recipe_id);

ALTER TABLE allowed_emails ADD COLUMN display_name TEXT;
