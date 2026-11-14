-- Ingredients that come from the butcher rather than the supermarket order; the price is then a usual/estimated cost.
ALTER TABLE ingredient_prices ADD COLUMN butcher INTEGER NOT NULL DEFAULT 0;
