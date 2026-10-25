const prisma = require('../lib/prisma');

// DEV/TEST ONLY: gives every seller who has no default_payment_terms a random
// placeholder (in days). Never overwrites a value a seller already set.
// Do NOT run against real data — payment terms are a commercial commitment.
const SAMPLE_TERMS = [0, 7, 8, 10, 15, 21, 30];

async function main() {
  const sellers = await prisma.appUser.findMany({
    where: { roles: { has: 'seller' }, defaultPaymentTerms: null },
    select: { id: true },
  });

  for (const seller of sellers) {
    const value = SAMPLE_TERMS[Math.floor(Math.random() * SAMPLE_TERMS.length)];
    await prisma.appUser.update({ where: { id: seller.id }, data: { defaultPaymentTerms: value } });
  }

  console.log(`Set a placeholder default_payment_terms on ${sellers.length} seller(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
