const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { validateUuid } = require('../lib/validators');
const { buildContainsFilter } = require('../lib/filters');

function validateName(name) {
  const trimmed = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
  if (!trimmed) {
    throw new AppError('name is required', 400);
  }
  return trimmed;
}

// Bulk add: trims every name, rejects blanks, and de-duplicates case-insensitively
// within the request itself ("Bold" and "bold " in one call is one quality).
function validateNames(names) {
  if (!Array.isArray(names) || names.length === 0) {
    throw new AppError('names must be a non-empty array', 400);
  }
  const seen = new Set();
  const unique = [];
  for (const raw of names) {
    const name = validateName(raw);
    const key = name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(name);
    }
  }
  return unique;
}

async function requireCategory(categoryId) {
  validateUuid(categoryId, 'categoryId');
  const category = await prisma.commodityCategory.findUnique({ where: { id: categoryId } });
  if (!category) {
    throw new AppError('Category not found', 404);
  }
  return category;
}

// Names are unique per category, case-insensitively ("Bold" vs "bold"). The DB unique
// index only catches exact matches, so the case-insensitive check lives here.
async function findByNameInsensitive(categoryId, name) {
  return prisma.quality.findFirst({
    where: { categoryId, name: { equals: name, mode: 'insensitive' } },
  });
}

async function writeAudit(actorUserId, action, entityId, before, after) {
  await prisma.auditLog.create({
    data: { actorUserId, action, entity: 'Quality', entityId, before, after },
  });
}

async function createQuality(categoryId, name, actorUserId) {
  await requireCategory(categoryId);
  const trimmedName = validateName(name);

  if (await findByNameInsensitive(categoryId, trimmedName)) {
    throw new AppError('This quality already exists in that category', 409);
  }

  let quality;
  try {
    quality = await prisma.quality.create({ data: { categoryId, name: trimmedName } });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new AppError('This quality already exists in that category', 409);
    }
    throw err;
  }

  await writeAudit(actorUserId, 'QUALITY_CREATED', quality.id, null, quality);
  return quality;
}

// Adds many qualities to one category in a single call. Names that already exist in
// the category are skipped (not an error) so the admin can paste a full list and
// re-run it safely; the rest are created atomically.
async function createQualitiesBulk(categoryId, names, actorUserId) {
  await requireCategory(categoryId);
  const uniqueNames = validateNames(names);

  const existing = await prisma.quality.findMany({ where: { categoryId } });
  const existingKeys = new Set(existing.map((q) => q.name.toLowerCase()));

  const toCreate = uniqueNames.filter((n) => !existingKeys.has(n.toLowerCase()));
  const skipped = uniqueNames.filter((n) => existingKeys.has(n.toLowerCase()));

  let created = [];
  if (toCreate.length > 0) {
    try {
      created = await prisma.$transaction(async (tx) => {
        const rows = [];
        for (const name of toCreate) {
          rows.push(await tx.quality.create({ data: { categoryId, name } }));
        }
        await tx.auditLog.createMany({
          data: rows.map((q) => ({
            actorUserId,
            action: 'QUALITY_CREATED',
            entity: 'Quality',
            entityId: q.id,
            before: null,
            after: q,
          })),
        });
        return rows;
      });
    } catch (err) {
      if (err.code === 'P2002') {
        // Lost a race with a concurrent create of the same name.
        throw new AppError('One of these qualities was just added — please retry', 409);
      }
      throw err;
    }
  }

  return { created, skipped };
}

async function listQualities({ categoryId, name, skip, take } = {}) {
  if (categoryId !== undefined) {
    validateUuid(categoryId, 'categoryId');
  }
  const nameFilter = buildContainsFilter(name);
  const where = {
    ...(categoryId ? { categoryId } : {}),
    ...(nameFilter ? { name: nameFilter } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.quality.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { category: { select: { name: true } } },
      skip,
      take,
    }),
    prisma.quality.count({ where }),
  ]);
  return { data, total };
}

// Rename only. A quality never moves between categories: listings already point at it
// and were validated against its category, so moving it would silently invalidate them.
async function updateQuality(id, { name }, actorUserId) {
  validateUuid(id);
  const existing = await prisma.quality.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Quality not found', 404);
  }

  const trimmedName = validateName(name);

  const clash = await findByNameInsensitive(existing.categoryId, trimmedName);
  if (clash && clash.id !== id) {
    throw new AppError('This quality already exists in that category', 409);
  }

  let updated;
  try {
    updated = await prisma.quality.update({ where: { id }, data: { name: trimmedName } });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new AppError('This quality already exists in that category', 409);
    }
    throw err;
  }

  await writeAudit(actorUserId, 'QUALITY_UPDATED', id, existing, updated);
  return updated;
}

async function deleteQuality(id, actorUserId) {
  validateUuid(id);
  const existing = await prisma.quality.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Quality not found', 404);
  }

  const listingCount = await prisma.listing.count({ where: { qualityId: id } });
  if (listingCount > 0) {
    throw new AppError("Cannot delete a quality that's still used by listings", 409);
  }

  try {
    await prisma.quality.delete({ where: { id } });
  } catch (err) {
    if (err.code === 'P2003') {
      throw new AppError("Cannot delete a quality that's still used by listings", 409);
    }
    throw err;
  }

  await writeAudit(actorUserId, 'QUALITY_DELETED', id, existing, null);
}

module.exports = {
  createQuality,
  createQualitiesBulk,
  listQualities,
  updateQuality,
  deleteQuality,
};
