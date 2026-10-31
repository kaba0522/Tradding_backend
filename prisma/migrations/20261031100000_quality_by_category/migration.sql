-- Quality becomes an admin-managed, per-category table (replaces the global
-- quality_grade enum). Existing listings are NOT migrated: their old enum value
-- is kept in quality_legacy, and quality_id stays NULL on them. When the old
-- listing data is wiped, a follow-up migration should drop quality_legacy and
-- the quality_grade enum, rebuild uq_listing_no_duplicate_sell on quality_id
-- alone, and make quality_id NOT NULL.

-- CreateTable
CREATE TABLE "quality" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_quality_category_id_name" ON "quality"("category_id", "name");

-- AddForeignKey
ALTER TABLE "quality" ADD CONSTRAINT "quality_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "commodity_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: keep the old enum column (renamed, no data loss) and add the new FK column.
ALTER TABLE "listing" RENAME COLUMN "quality" TO "quality_legacy";
ALTER TABLE "listing" ADD COLUMN "quality_id" UUID;

-- CreateIndex
CREATE INDEX "ix_listing_quality" ON "listing"("quality_id");

-- AddForeignKey
ALTER TABLE "listing" ADD CONSTRAINT "listing_quality_id_fkey" FOREIGN KEY ("quality_id") REFERENCES "quality"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rebuild the duplicate-SELL guard on the new column. quality_legacy stays in the
-- key so that old rows (quality_id NULL) which differ only by legacy grade don't
-- collide with each other (NULLS NOT DISTINCT would otherwise treat them as equal).
DROP INDEX "uq_listing_no_duplicate_sell";
CREATE UNIQUE INDEX "uq_listing_no_duplicate_sell"
ON "listing" ("user_id", "category_id", "commodity_id", "weight_kg", "quality_id", "quality_legacy")
NULLS NOT DISTINCT
WHERE "side" = 'SELL' AND "status" IN ('active', 'na', 'price_expired');
