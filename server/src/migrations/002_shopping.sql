CREATE TABLE shopping_items (
  id TEXT PRIMARY KEY,
  merge_key TEXT NOT NULL,
  item TEXT NOT NULL,
  quantity REAL,
  unit TEXT,
  note TEXT,
  sources_json TEXT NOT NULL,
  added_at TEXT NOT NULL,
  merged INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX shopping_items_merge_key ON shopping_items (merge_key);
