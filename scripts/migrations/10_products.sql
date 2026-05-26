-- 10_products.sql — Fixed product catalog with admin-editable prices.
--
-- The order entry UI is built around a small fixed catalog. Staff pick
-- from cards (Hen/Rooster/Duck, Whole goat, Retail goat ±skin, Eggs) and
-- the price auto-fills. Admin can override per-line on a transaction and
-- can also change the defaults from the admin Products page.
--
-- Why a `code` column? UI groups products into 4 top-level cards
-- (poultry, whole_goat, retail_goat, eggs). A stable `code` lets the UI
-- look products up by identity instead of by display name, which the
-- admin may edit.
--
-- `service_fee` is a flat per-unit surcharge applied in addition to
-- quantity × unit_price. Only used for whole_goat today ($50/goat),
-- defaults to 0 for everything else.

CREATE TABLE IF NOT EXISTS products (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable identifier the UI keys on (e.g. 'hen', 'whole_goat'). Lowercase, underscore.
  code          text        NOT NULL UNIQUE,
  -- Top-level card the product belongs to (e.g. 'poultry', 'retail_goat').
  group_code    text        NOT NULL,
  -- Human-readable label of the top-level card (e.g. 'Hen / Rooster / Duck').
  -- Stored on each row to keep the seed self-contained; the UI uses the
  -- value from the first row in each group.
  group_label   text        NOT NULL,
  -- Display name for the product itself ('Hen', 'Whole goat — with skin', ...).
  name          text        NOT NULL,
  -- 'each' (whole bird, tray), 'lb' (weight-priced goat).
  unit          text        NOT NULL CHECK (unit IN ('each','lb','tray')),
  default_price numeric(10,2) NOT NULL CHECK (default_price >= 0),
  -- Flat surcharge added on top of quantity × price. Per-unit, so 2 goats = 2×fee.
  service_fee   numeric(10,2) NOT NULL DEFAULT 0 CHECK (service_fee >= 0),
  -- 7-char hex used as the top-level catalog card background tint
  -- (the colored block the staff taps from the new-order screen).
  -- Set on the GROUP's lowest-sort row; child rows can carry their own
  -- but the card-renderer reads the group leader.
  accent_color  text        NOT NULL DEFAULT '#1A1715' CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  -- Ordering: lowest first. Top-level cards by min(sort_order) of their group.
  sort_order    integer     NOT NULL DEFAULT 100,
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_active_sort
  ON products (group_code, sort_order, name) WHERE archived_at IS NULL;

-- accent_color was added after the initial cut of this migration. The
-- IF NOT EXISTS keeps a re-run safe for installs that ran the earlier
-- version. The CHECK is added separately so the column-add succeeds
-- even when prior data exists.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS accent_color text NOT NULL DEFAULT '#1A1715';
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_accent_color_check'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_accent_color_check CHECK (accent_color ~ '^#[0-9a-fA-F]{6}$');
  END IF;
END $$;

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Seed the starter catalog. Skip if the admin already populated any
-- product so re-running the migration doesn't clobber custom rates.
DO $$
DECLARE
  v_existing int;
BEGIN
  SELECT COUNT(*) INTO v_existing FROM products WHERE archived_at IS NULL;
  IF v_existing > 0 THEN RETURN; END IF;

  -- Each product gets its OWN accent so the catalog AND the sub-product
  -- cards (Hen / Rooster / Duck etc.) each render as a distinctive tile.
  -- Top-level group cards take the color of their lowest-sort product:
  --   Poultry      → Hen     · golden amber
  --   Whole goat   → Whole goat · brand red
  --   Retail goat  → with-skin  · deep wine
  --   Eggs         → Eggs    · ocean teal
  INSERT INTO products (code, group_code, group_label, name, unit, default_price, service_fee, accent_color, sort_order) VALUES
    ('hen',                  'poultry',     'Hen / Rooster / Duck', 'Hen',                       'each', 10.00, 0,  '#F59E0B', 10),  -- golden amber
    ('rooster',              'poultry',     'Hen / Rooster / Duck', 'Rooster',                   'each', 20.00, 0,  '#9A3412', 20),  -- rust
    ('duck',                 'poultry',     'Hen / Rooster / Duck', 'Duck',                      'each', 25.00, 0,  '#166534', 30),  -- forest green
    ('whole_goat',           'whole_goat',  'Whole goat',           'Whole goat',                'lb',    5.50, 50, '#B0322B', 40),  -- brand red
    ('retail_goat_skin',     'retail_goat', 'Retail goat',          'Retail goat — with skin',   'lb',   11.00, 0,  '#7C1D1D', 50),  -- deep wine
    ('retail_goat_skinless', 'retail_goat', 'Retail goat',          'Retail goat — without skin','lb',   12.00, 0,  '#1F2937', 60),  -- slate
    ('eggs',                 'eggs',        'Eggs',                 'Eggs (tray)',               'tray', 15.00, 0,  '#0E7490', 70);  -- ocean teal
END $$;

-- Re-seed accent colors for installs that ran an earlier version of this
-- migration (which used a single color per group). Only touches rows whose
-- color still matches one of those old defaults — any admin customization
-- via the Products page is preserved.
UPDATE products SET accent_color = CASE code
  WHEN 'hen'                  THEN '#F59E0B'
  WHEN 'rooster'              THEN '#9A3412'
  WHEN 'duck'                 THEN '#166534'
  WHEN 'whole_goat'           THEN '#B0322B'
  WHEN 'retail_goat_skin'     THEN '#7C1D1D'
  WHEN 'retail_goat_skinless' THEN '#1F2937'
  WHEN 'eggs'                 THEN '#0E7490'
  ELSE accent_color
END
WHERE code IN ('hen','rooster','duck','whole_goat','retail_goat_skin','retail_goat_skinless','eggs')
  AND accent_color IN ('#D97706','#B0322B','#7C1D1D','#0E7490','#1A1715');

-- Carry the catalog identity on each order line so the create path can
-- enforce staff-locked prices. NULL for legacy rows + the service-fee
-- helper line; non-NULL rows must match a `products.code` at write time.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS product_code text;

CREATE INDEX IF NOT EXISTS idx_order_items_product_code
  ON order_items (product_code) WHERE product_code IS NOT NULL;

-- ============================================================
-- ROLLBACK (manual — uncomment and run to undo this migration)
-- ============================================================
-- DROP INDEX IF EXISTS idx_order_items_product_code;
-- ALTER TABLE order_items DROP COLUMN IF EXISTS product_code;
-- DROP INDEX IF EXISTS idx_products_active_sort;
-- DROP TABLE IF EXISTS products;
