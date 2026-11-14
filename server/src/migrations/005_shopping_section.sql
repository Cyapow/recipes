-- Which part of the list an item belongs to: the online order ('shop') or the butcher ('butcher').
ALTER TABLE shopping_items ADD COLUMN section TEXT NOT NULL DEFAULT 'shop';
