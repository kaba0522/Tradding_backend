const prisma = require('../lib/prisma');
const freightService = require('../services/freight.service');

// Sample freight routes for development / demos. Safe to re-run: a route whose
// (origin, destination) already exists (ignoring case) just gets its price refreshed
// (which also gives it a fresh expiry), anything else is created. Nothing is deleted.
//
//   node prisma/seed-freight.js
//
// Rows are [origin, destination, priceLow, priceHigh | null (single price), truckCapacity | null].
const ROUTES = [
  // Same layout as the reference freight screen (state origins -> ports)
  ['Punjab', 'Kandla Port', 160, 165, '30-35 MT'],
  ['Punjab', 'Mundra Port', 170, 178, '30-35 MT'],
  ['Punjab', 'Pipavav Port', 200, 205, '25-30 MT'],
  ['Punjab', 'Nhava Sheva', 210, null, '30-35 MT'],
  ['Haryana', 'Kandla Port', 150, 155, '30-35 MT'],
  ['Haryana', 'Mundra Port', 160, 165, '30-35 MT'],
  ['Haryana', 'Nhava Sheva', 195, null, '30-35 MT'],
  ['Rajasthan', 'Kandla Port', 120, 125, '30-35 MT'],
  ['Rajasthan', 'Mundra Port', 130, 135, '30-35 MT'],
  ['Rajasthan', 'Nhava Sheva', 175, null, '30-35 MT'],
  ['J&K', 'Kandla Port', 210, 220, '25-30 MT'],

  // More states: same destinations from different origins, and new destinations
  ['J&K', 'Mundra Port', 220, 230, '25-30 MT'],
  ['J&K', 'Nhava Sheva', 260, null, '25-30 MT'],
  ['Haryana', 'Pipavav Port', 185, 190, '30-35 MT'],
  ['Rajasthan', 'Pipavav Port', 140, 145, '30-35 MT'],
  ['Uttar Pradesh', 'Kandla Port', 190, 200, '30-35 MT'],
  ['Uttar Pradesh', 'Mundra Port', 200, 210, '30-35 MT'],
  ['Uttar Pradesh', 'Nhava Sheva', 230, null, '30-35 MT'],
  ['Gujarat', 'Mundra Port', 60, 65, '30-35 MT'],
  ['Gujarat', 'Kandla Port', 50, null, '30-35 MT'],
  ['Gujarat', 'Nhava Sheva', 110, 115, '25-30 MT'],

  // City origins: several destinations each, some going to a city instead of a port
  ['Ludhiana', 'Kandla Port', 165, 170, '30-35 MT'],
  ['Ludhiana', 'Mundra Port', 175, 180, '30-35 MT'],
  ['Ludhiana', 'Delhi', 55, 60, null],
  ['Amritsar', 'Kandla Port', 170, 175, '30-35 MT'],
  ['Amritsar', 'Ludhiana', 40, 45, null],
  ['Amritsar', 'Delhi', 70, 75, '25-30 MT'],
  ['Karnal', 'Mundra Port', 155, 160, '30-35 MT'],
  ['Karnal', 'Delhi', 35, null, null],
];

async function main() {
  const admin = await prisma.appUser.findFirst({
    where: { roles: { has: 'admin' }, status: 'active' },
    orderBy: { createdAt: 'asc' },
  });
  if (!admin) {
    throw new Error('No active admin user found — run `npm run seed` first.');
  }

  const existing = await prisma.freightRoute.findMany();
  const byPair = new Map(existing.map((r) => [`${r.originName}|${r.destinationName}`.toLowerCase(), r]));

  let created = 0;
  let updated = 0;
  for (const [originName, destinationName, priceLow, priceHigh, truckCapacity] of ROUTES) {
    const found = byPair.get(`${originName}|${destinationName}`.toLowerCase());
    const body = { priceLow, ...(priceHigh === null ? {} : { priceHigh }), truckCapacity };
    if (found) {
      await freightService.updateRoute(found.id, body, admin.id);
      updated += 1;
    } else {
      await freightService.createRoute({ originName, destinationName, ...body }, admin.id);
      created += 1;
    }
  }

  console.log(`Freight seed done: ${created} created, ${updated} refreshed (${ROUTES.length} routes).`);
}

main()
  .catch((err) => {
    console.error('Freight seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
