-- What one pack of an ingredient costs, keyed by the normalised ingredient name.
-- `source` says where the number came from ('manual' today; room for a shop lookup later).
CREATE TABLE ingredient_prices (
  key TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  price_pence INTEGER NOT NULL,
  clubcard_pence INTEGER,
  pack_note TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT NOT NULL
);
