const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { validateUuid } = require('../lib/validators');
const { buildContainsFilter } = require('../lib/filters');

function validateName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) {
    throw new AppError('name is required', 400);
  }
  return trimmed;
}

async function createCategory(name, actorUserId) {
  const trimmedName = validateName(name);

  let category;
  try {
    category = await prisma.commodityCategory.create({ data: { name: trimmedName } });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new AppError('A category with this name already exists', 409);
    }
    throw err;
  }

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'CATEGORY_CREATED',
      entity: 'CommodityCategory',
      entityId: category.id,
      before: null,
      after: category,
    },
  });

  return category;
}

async function listCategories({ name, skip, take } = {}) {
  const nameFilter = buildContainsFilter(name);
  const where = nameFilter ? { name: nameFilter } : undefined;

  const [rows, total] = await Promise.all([
    prisma.commodityCategory.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take,
      include: { _count: { select: { qualities: true } } },
    }),
    prisma.commodityCategory.count({ where }),
  ]);
  // qualityCount lets the admin UI flag categories that still have no qualities
  // (listings can't be created in them until at least one is added).
  const data = rows.map(({ _count, ...category }) => ({ ...category, qualityCount: _count.qualities }));
  return { data, total };
}

async function renameCategory(id, newName, actorUserId) {
  validateUuid(id);
  const existing = await prisma.commodityCategory.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Category not found', 404);
  }

  const trimmedName = validateName(newName);

  let updated;
  try {
    updated = await prisma.commodityCategory.update({
      where: { id },
      data: { name: trimmedName },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw new AppError('A category with this name already exists', 409);
    }
    throw err;
  }

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'CATEGORY_RENAMED',
      entity: 'CommodityCategory',
      entityId: id,
      before: existing,
      after: updated,
    },
  });

  return updated;
}

async function deleteCategory(id, actorUserId) {
  validateUuid(id);
  const existing = await prisma.commodityCategory.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Category not found', 404);
  }

  try {
    await prisma.commodityCategory.delete({ where: { id } });
  } catch (err) {
    if (err.code === 'P2003') {
      throw new AppError(
        'Cannot delete a category that is still referenced by commodities, qualities, listings, or buyer requirements',
        409
      );
    }
    throw err;
  }

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'CATEGORY_DELETED',
      entity: 'CommodityCategory',
      entityId: id,
      before: existing,
      after: null,
    },
  });
}

module.exports = { createCategory, listCategories, renameCategory, deleteCategory };
