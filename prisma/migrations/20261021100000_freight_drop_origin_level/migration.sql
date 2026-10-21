-- Freight routes are always city -> city, so origin_level (STATE|CITY) is not needed.
-- freight_route was verified empty (0 rows) before this migration was written.
ALTER TABLE "freight_route" DROP COLUMN "origin_level";
DROP TYPE "origin_level";

-- One route per (origin, destination) pair, ignoring case. Prisma can't express a
-- functional index in schema.prisma, so it lives only here (same approach as
-- uq_listing_no_duplicate_sell). Backs the upsert in freight.service.js.
CREATE UNIQUE INDEX "uq_freight_route_origin_destination"
  ON "freight_route" (lower("origin_name"), lower("destination_name"));
