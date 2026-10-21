const prisma = require('../lib/prisma');

// Phone numbers are placeholders — replace with real admin numbers before running.
const ADMIN_USERS = [
  { phone: '+919810000001', name: 'Admin One' },
  { phone: '+919810000002', name: 'Admin Two' },
];

// Default settings, seeded only if the key doesn't already exist — never
// overwrite a value an admin has since changed via the API.
const DEFAULT_SETTINGS = [
  { key: 'price_expiry_time', value: { time: '02:00' } },
  { key: 'freight_expiry_time', value: { time: '02:00' } },
];

async function main() {
  for (const admin of ADMIN_USERS) {
    await prisma.appUser.upsert({
      where: { phone: admin.phone },
      update: { roles: ['admin'] },
      create: {
        phone: admin.phone,
        name: admin.name,
        roles: ['admin'],
        status: 'active',
      },
    });
  }

  for (const setting of DEFAULT_SETTINGS) {
    const existing = await prisma.setting.findUnique({ where: { key: setting.key } });
    if (!existing) {
      await prisma.setting.create({
        data: { key: setting.key, value: setting.value, updatedBy: null },
      });
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
