-- Broker flow: commission moves from the broker to the commodity category.
--   * broker loses its own commission_type / commission_rate (one rate per category now,
--     the same for every broker). Any rate already stored on a broker row is dropped.
--   * the 'flat' (per trade) commission type goes away: flat now means per_bag only.
--   * broker.user_id comes back: set when the broker first logs in, so a logged-in broker
--     can be matched to their broker row (and so to trade.broker_id).
--   * every trade carries a commission snapshot taken when it is confirmed.
-- trade was verified empty (0 rows) before this migration was written, so the NOT NULL
-- commission_status column needs no backfill.

-- DropConstraint + DropColumns (commission moves off the broker)
ALTER TABLE "broker" DROP CONSTRAINT "ck_broker_commission";
ALTER TABLE "broker" DROP COLUMN "commission_type",
DROP COLUMN "commission_rate";

-- Recreate the enum without 'flat' (nothing references it any more).
DROP TYPE "commission_type";
CREATE TYPE "commission_type" AS ENUM ('percent', 'per_bag');

-- CreateEnum
CREATE TYPE "trade_commission_status" AS ENUM ('set', 'not_set', 'none');

-- broker.user_id: link to the app_user created on the broker's first login.
ALTER TABLE "broker" ADD COLUMN "user_id" UUID;
CREATE UNIQUE INDEX "broker_user_id_key" ON "broker"("user_id");
ALTER TABLE "broker" ADD CONSTRAINT "broker_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "category_commission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "commission_type" "commission_type" NOT NULL,
    "rate" DECIMAL(10,2) NOT NULL,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_commission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "category_commission_category_id_key" ON "category_commission"("category_id");

-- AddForeignKey
ALTER TABLE "category_commission" ADD CONSTRAINT "category_commission_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "commodity_category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "category_commission" ADD CONSTRAINT "category_commission_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "category_commission" ADD CONSTRAINT "category_commission_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A rate is never negative and a percentage never exceeds 100. Mirrors
-- services/commission.validation.js so no code path (API, script, manual SQL) can
-- store a bad rate.
ALTER TABLE "category_commission"
  ADD CONSTRAINT "ck_category_commission"
  CHECK ("rate" >= 0 AND ("commission_type" <> 'percent' OR "rate" <= 100));

-- Trade commission snapshot.
ALTER TABLE "trade"
  ADD COLUMN "commission_status" "trade_commission_status" NOT NULL,
  ADD COLUMN "commission_type" "commission_type",
  ADD COLUMN "commission_rate" DECIMAL(10,2),
  ADD COLUMN "commission_amount" DECIMAL(12,2),
  ADD COLUMN "commission_category_id" UUID,
  ADD COLUMN "commission_set_by" UUID,
  ADD COLUMN "commission_set_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "ix_trade_commission_status" ON "trade"("commission_status");

-- AddForeignKey
ALTER TABLE "trade" ADD CONSTRAINT "trade_commission_category_id_fkey" FOREIGN KEY ("commission_category_id") REFERENCES "commodity_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trade" ADD CONSTRAINT "trade_commission_set_by_fkey" FOREIGN KEY ("commission_set_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Which columns are filled depends on the status:
--   set     -> type, rate, amount and category all filled (rate in range)
--   not_set -> nothing filled yet; the admin fills it in later
--   none    -> Self / free-text broker: no rate, amount is exactly 0
ALTER TABLE "trade"
  ADD CONSTRAINT "ck_trade_commission"
  CHECK (
    (
      "commission_status" = 'set'
      AND "commission_type" IS NOT NULL
      AND "commission_rate" IS NOT NULL
      AND "commission_amount" IS NOT NULL
      AND "commission_category_id" IS NOT NULL
      AND "commission_rate" >= 0
      AND ("commission_type" <> 'percent' OR "commission_rate" <= 100)
      AND "commission_amount" >= 0
    )
    OR (
      "commission_status" = 'not_set'
      AND "commission_type" IS NULL
      AND "commission_rate" IS NULL
      AND "commission_amount" IS NULL
      AND "commission_set_by" IS NULL
      AND "commission_set_at" IS NULL
    )
    OR (
      "commission_status" = 'none'
      AND "commission_type" IS NULL
      AND "commission_rate" IS NULL
      AND "commission_amount" = 0
      AND "commission_category_id" IS NULL
      AND "commission_set_by" IS NULL
      AND "commission_set_at" IS NULL
    )
  );
