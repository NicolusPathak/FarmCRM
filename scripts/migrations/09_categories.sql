-- 09_categories.sql — Item categories + alias-based bucketing for reports.
--
-- What changes:
--   1. product_categories: admin-managed buckets (Goat, Chicken, Egg, Fish, ...).
--   2. category_aliases:    text → category mapping for noisy item_name input.
--      `alias_normalized` is the lowercased/trimmed form used at lookup time.
--      One alias maps to exactly one category (UNIQUE on alias_normalized).
--   3. Seed: three starter categories (Goat, Chicken, Egg) with common
--      aliases so the end-of-day report shows something the moment the
--      migration runs. Skipped if the admin has already added any category.
--
-- The fuzzy-match (Levenshtein 1, case-insensitive) lives in app code
-- (lib/categories.ts) — kept out of SQL so we don't have to require the
-- pg_trgm extension and so the alias set is small enough to scan in JS.
--
-- Future migration: a `products` table that JOINs to categories (each
-- `order_items` row gets `product_id`). This migration stops short of that
-- — categories are useful for reporting on their own and don't require
-- changing the order entry UI.

CREATE TABLE IF NOT EXISTS product_categories (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  -- 7-char hex (e.g. #b0322b) — used as the row tint in the report.
  -- Defaults to a soft slate so a newly-added category still renders.
  color       text        NOT NULL DEFAULT '#64748b',
  sort_order  integer     NOT NULL DEFAULT 100,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Name unique across ACTIVE categories only (archived rows can keep their old name).
CREATE UNIQUE INDEX IF NOT EXISTS product_categories_name_active_key
  ON product_categories (lower(name)) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_product_categories_sort
  ON product_categories (sort_order, name) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS category_aliases (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id       uuid        NOT NULL REFERENCES product_categories(id) ON DELETE CASCADE,
  -- Original text as the admin typed it (display-friendly).
  alias             text        NOT NULL,
  -- Lowercased, trimmed, internal whitespace collapsed.
  -- This is what the report engine matches against.
  alias_normalized  text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS category_aliases_normalized_key
  ON category_aliases (alias_normalized);

CREATE INDEX IF NOT EXISTS idx_category_aliases_category
  ON category_aliases (category_id);

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_aliases   ENABLE ROW LEVEL SECURITY;

-- Seed starter categories. Skip the entire block if any active category
-- already exists, so a re-run after the admin has customized the list
-- doesn't clobber their changes.
DO $$
DECLARE
  v_existing   int;
  v_goat_id    uuid;
  v_chicken_id uuid;
  v_egg_id     uuid;
BEGIN
  SELECT COUNT(*) INTO v_existing FROM product_categories WHERE archived_at IS NULL;
  IF v_existing > 0 THEN RETURN; END IF;

  INSERT INTO product_categories (name, color, sort_order)
    VALUES ('Goat', '#b0322b', 10) RETURNING id INTO v_goat_id;
  INSERT INTO product_categories (name, color, sort_order)
    VALUES ('Chicken', '#d97706', 20) RETURNING id INTO v_chicken_id;
  INSERT INTO product_categories (name, color, sort_order)
    VALUES ('Egg', '#0891b2', 30) RETURNING id INTO v_egg_id;

  INSERT INTO category_aliases (category_id, alias, alias_normalized) VALUES
    (v_goat_id,    'goat',          'goat'),
    (v_goat_id,    'mutton',        'mutton'),
    (v_goat_id,    'goat curry',    'goat curry'),
    (v_goat_id,    'goat head',     'goat head'),
    (v_goat_id,    'goat leg',      'goat leg'),
    (v_goat_id,    'bakra',         'bakra'),
    (v_chicken_id, 'chicken',       'chicken'),
    (v_chicken_id, 'whole chicken', 'whole chicken'),
    (v_chicken_id, 'chicken curry', 'chicken curry'),
    (v_chicken_id, 'murgi',         'murgi'),
    (v_egg_id,     'egg',           'egg'),
    (v_egg_id,     'eggs',          'eggs'),
    (v_egg_id,     'anda',          'anda'),
    (v_egg_id,     'dozen eggs',    'dozen eggs');
END $$;

-- ============================================================
-- ROLLBACK (manual — uncomment and run to undo this migration)
-- ============================================================
-- DROP INDEX IF EXISTS category_aliases_normalized_key;
-- DROP INDEX IF EXISTS idx_category_aliases_category;
-- DROP INDEX IF EXISTS product_categories_name_active_key;
-- DROP INDEX IF EXISTS idx_product_categories_sort;
-- DROP TABLE IF EXISTS category_aliases;
-- DROP TABLE IF EXISTS product_categories;
