-- Shops, and the ways each ingredient can be bought (packs). Replaces ingredient_prices.
CREATE TABLE shops (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  position INTEGER NOT NULL
);
INSERT INTO shops (id, name, position) VALUES ('tesco', 'Tesco', 1), ('butcher', 'Butcher', 2);

-- shop_id NULL means the default shop (the first one). `unit` is what pack amounts are counted in:
-- '' for whole items, otherwise a normalised unit such as 'g', 'ml' or 'tin'.
CREATE TABLE ingredient_info (
  key TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  shop_id TEXT REFERENCES shops(id) ON DELETE SET NULL,
  unit TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- amount NULL means "this pack covers whatever the recipes need" (how single prices worked before).
CREATE TABLE ingredient_packs (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL REFERENCES ingredient_info(key) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  amount REAL,
  price_pence INTEGER NOT NULL,
  clubcard_pence INTEGER,
  position INTEGER NOT NULL
);
CREATE INDEX ingredient_packs_key ON ingredient_packs (key);

INSERT INTO ingredient_info (key, item, shop_id, unit, updated_at)
  SELECT key, item, CASE butcher WHEN 1 THEN 'butcher' ELSE NULL END, '', updated_at FROM ingredient_prices;
INSERT INTO ingredient_packs (id, key, label, amount, price_pence, clubcard_pence, position)
  SELECT lower(hex(randomblob(16))), key, COALESCE(pack_note, ''), NULL, price_pence, clubcard_pence, 0 FROM ingredient_prices;
DROP TABLE ingredient_prices;

-- Shopping rows now carry the shop's name as their section ('shop' = the default shop).
UPDATE shopping_items SET section = 'Butcher' WHERE section = 'butcher';
