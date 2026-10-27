-- Admin broker CRUD: phone, default commission, and who/when tracking.
-- broker was verified empty (0 rows, and no trade references a broker) before this
-- migration was written, so the NOT NULL columns need no backfill.
-- user_id is dropped: it was never used by any code path; a broker who also logs in
-- is matched to their AppUser by phone instead.

-- CreateEnum
CREATE TYPE "commission_type" AS ENUM ('percent', 'per_bag', 'flat');

-- DropForeignKey
ALTER TABLE "broker" DROP CONSTRAINT "broker_user_id_fkey";

-- AlterTable
ALTER TABLE "broker" DROP COLUMN "user_id",
ADD COLUMN     "commission_rate" DECIMAL(10,2),
ADD COLUMN     "commission_type" "commission_type",
ADD COLUMN     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "created_by" UUID NOT NULL,
ADD COLUMN     "phone" TEXT NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updated_by" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "broker_phone_key" ON "broker"("phone");

-- CreateIndex
CREATE INDEX "ix_broker_active_name" ON "broker"("active", "name");

-- AddForeignKey
ALTER TABLE "broker" ADD CONSTRAINT "broker_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "broker" ADD CONSTRAINT "broker_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Commission type and rate are set together or not at all; a rate is never negative,
-- and a percentage never exceeds 100. Mirrors services/broker.validation.js so no code
-- path (API, script, manual SQL) can store a half-filled commission.
ALTER TABLE "broker"
  ADD CONSTRAINT "ck_broker_commission"
  CHECK (
    ("commission_type" IS NULL AND "commission_rate" IS NULL)
    OR (
      "commission_type" IS NOT NULL
      AND "commission_rate" IS NOT NULL
      AND "commission_rate" >= 0
      AND ("commission_type" <> 'percent' OR "commission_rate" <= 100)
    )
  );
