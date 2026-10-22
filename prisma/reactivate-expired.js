// One-off: bring already-expired listings / freight routes back to active, keeping
// their stored price (expiry never clears it). Safe to re-run.
//
// Usage: DATABASE_URL=<url> node prisma/reactivate-expired.js
require('dotenv').config();
const prisma = require('../lib/prisma');

async function main() {
  const listings = await prisma.listing.updateMany({
    where: { status: 'price_expired', price: { not: null } },
    data: { status: 'active', priceValidUntil: null },
  });
  const routes = await prisma.freightRoute.updateMany({
    where: { status: 'price_expired' },
    data: { status: 'active', priceValidUntil: null },
  });
  console.log(`reactivated ${listings.count} listing(s), ${routes.count} freight route(s)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
