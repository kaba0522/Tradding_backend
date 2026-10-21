const prisma = require('../lib/prisma');

// Flips `active` -> `price_expired` for any row whose individually-stored
// priceValidUntil has passed. `price` is never touched here (sticky rule —
// see listing.service.js §2). Side-agnostic: applies to SELL and BUY listings
// alike, and to FreightRoute (CLAUDE.md §4.9). Freight has its own expiry time
// (freight_expiry_time setting) but that only affects the priceValidUntil stamped on
// each row at write time — this job just compares each row's own timestamp to `now`.
async function expireStalePrices(now = new Date()) {
  const [listingResult, freightResult] = await Promise.all([
    prisma.listing.updateMany({
      where: { status: 'active', priceValidUntil: { lte: now } },
      data: { status: 'price_expired' },
    }),
    prisma.freightRoute.updateMany({
      where: { status: 'active', priceValidUntil: { lte: now } },
      data: { status: 'price_expired' },
    }),
  ]);

  return {
    listingsExpired: listingResult.count,
    freightRoutesExpired: freightResult.count,
  };
}

module.exports = { expireStalePrices };
