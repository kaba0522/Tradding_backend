const prisma = require('../lib/prisma');

// One-time backfill: copies each owner's default_payment_terms into their live SELL
// listings that have no payment_terms yet (listings created before copy-at-save).
// traded/withdrawn listings are left alone. Owners with no default are skipped.
//
//   npm run backfill:payment-terms            -> dry run (counts only)
//   npm run backfill:payment-terms -- --apply -> writes
const APPLY = process.argv.includes('--apply');

async function main() {
  const [{ count: eligible }] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "listing" l
    JOIN "app_user" u ON u.id = l.user_id
    WHERE l.side = 'SELL'
      AND l.payment_terms IS NULL
      AND l.status IN ('active', 'price_expired', 'na')
      AND u.default_payment_terms IS NOT NULL
  `;
  const [{ count: noDefault }] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "listing" l
    JOIN "app_user" u ON u.id = l.user_id
    WHERE l.side = 'SELL'
      AND l.payment_terms IS NULL
      AND l.status IN ('active', 'price_expired', 'na')
      AND u.default_payment_terms IS NULL
  `;

  console.log(`Listings that can be backfilled: ${eligible}`);
  console.log(`Listings skipped (owner has no default payment terms): ${noDefault}`);

  if (!APPLY) {
    console.log('Dry run — nothing written. Re-run with --apply to write.');
    return;
  }

  const updated = await prisma.$executeRaw`
    UPDATE "listing" l
    SET payment_terms = u.default_payment_terms
    FROM "app_user" u
    WHERE u.id = l.user_id
      AND l.side = 'SELL'
      AND l.payment_terms IS NULL
      AND l.status IN ('active', 'price_expired', 'na')
      AND u.default_payment_terms IS NOT NULL
  `;
  console.log(`Updated ${updated} listing(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
