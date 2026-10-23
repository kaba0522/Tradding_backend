-- A buy requirement (side = 'BUY') never has a price and therefore never expires:
-- the price is agreed in negotiation. Enforce it at the DB level so no code path
-- (API, admin edit, script) can store one.

-- 1. Clean existing BUY rows so the constraint can be added.
UPDATE "listing"
SET "price" = NULL, "price_valid_until" = NULL
WHERE "side" = 'BUY' AND ("price" IS NOT NULL OR "price_valid_until" IS NOT NULL);

-- A BUY row can no longer be price_expired (that status only means "price lapsed").
UPDATE "listing"
SET "status" = 'active'
WHERE "side" = 'BUY' AND "status" = 'price_expired';

-- 2. Guard.
ALTER TABLE "listing"
  ADD CONSTRAINT "ck_listing_buy_no_price"
  CHECK ("side" <> 'BUY' OR ("price" IS NULL AND "price_valid_until" IS NULL));
