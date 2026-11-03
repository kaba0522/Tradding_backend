const { Prisma } = require('@prisma/client');
const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { validateUuid } = require('../lib/validators');
const { buildCommissionValue } = require('./commission.validation');

const { Decimal } = Prisma;

const USER_SUMMARY_SELECT = { id: true, name: true, phone: true };

function toNumberOrNull(decimal) {
  return decimal === null || decimal === undefined ? null : Number(decimal);
}

function serializeCategoryCommission(row) {
  const { rate, ...rest } = row;
  return { ...rest, commissionRate: toNumberOrNull(rate) };
}

// Only these trade columns hold the commission, so only they go into audit snapshots.
function tradeCommissionSnapshot(trade) {
  return {
    commissionStatus: trade.commissionStatus,
    commissionType: trade.commissionType,
    commissionRate: toNumberOrNull(trade.commissionRate),
    commissionAmount: toNumberOrNull(trade.commissionAmount),
    commissionCategoryId: trade.commissionCategoryId,
    commissionSetById: trade.commissionSetById,
    commissionSetAt: trade.commissionSetAt,
  };
}

// per_bag: rate x bags.   percent: (final price x bags) x rate / 100.
// Decimal (not float) so ₹ amounts don't pick up binary rounding noise; rounded to
// paise, half-up.
function calculateCommissionAmount({ commissionType, rate, finalPrice, quantityBags }) {
  const bags = new Decimal(quantityBags);
  const amount =
    commissionType === 'per_bag'
      ? new Decimal(rate).mul(bags)
      : new Decimal(finalPrice).mul(bags).mul(new Decimal(rate)).div(100);
  return amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

// ---------------------------------------------------------------------------
// Category rates (admin)
// ---------------------------------------------------------------------------

// Every category, with its rate or nulls when none is set yet, so the admin panel
// can show "Not set" next to the categories that still need a rate.
async function listCategoryCommissions() {
  const categories = await prisma.commodityCategory.findMany({
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    include: {
      commission: {
        include: { createdBy: { select: USER_SUMMARY_SELECT }, updatedBy: { select: USER_SUMMARY_SELECT } },
      },
    },
  });

  return categories.map((category) => {
    const row = category.commission;
    return {
      categoryId: category.id,
      categoryName: category.name,
      isSet: Boolean(row),
      commissionType: row ? row.commissionType : null,
      commissionRate: row ? Number(row.rate) : null,
      createdBy: row ? row.createdBy : null,
      updatedBy: row ? row.updatedBy : null,
      createdAt: row ? row.createdAt : null,
      updatedAt: row ? row.updatedAt : null,
    };
  });
}

async function findCategoryOrThrow(db, categoryId) {
  validateUuid(categoryId, 'categoryId');
  const category = await db.commodityCategory.findUnique({ where: { id: categoryId } });
  if (!category) {
    throw new AppError('Commodity category not found', 404);
  }
  return category;
}

// Sets or changes the rate for one category. Only trades confirmed after this call
// use the new rate: past trades hold their own snapshot.
async function setCategoryCommission(categoryId, body, actorUserId) {
  const { commissionType, commissionRate } = buildCommissionValue(body);

  try {
    return await prisma.$transaction(async (tx) => {
      const category = await findCategoryOrThrow(tx, categoryId);
      const existing = await tx.categoryCommission.findUnique({ where: { categoryId } });

      if (existing && existing.commissionType === commissionType && Number(existing.rate) === commissionRate) {
        return serializeCategoryCommission({ ...existing, categoryName: category.name });
      }

      const saved = existing
        ? await tx.categoryCommission.update({
            where: { categoryId },
            data: { commissionType, rate: commissionRate, updatedById: actorUserId, updatedAt: new Date() },
          })
        : await tx.categoryCommission.create({
            data: { categoryId, commissionType, rate: commissionRate, createdById: actorUserId },
          });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: existing ? 'CATEGORY_COMMISSION_UPDATED' : 'CATEGORY_COMMISSION_SET',
          entity: 'CategoryCommission',
          entityId: saved.id,
          before: existing ? serializeCategoryCommission({ ...existing, categoryName: category.name }) : null,
          after: serializeCategoryCommission({ ...saved, categoryName: category.name }),
        },
      });

      return serializeCategoryCommission({ ...saved, categoryName: category.name });
    });
  } catch (err) {
    // Lost a race with a concurrent first-time set on the same category.
    if (err.code === 'P2002') {
      throw new AppError('This category was just given a rate by someone else — reload and try again', 409);
    }
    throw err;
  }
}

// Removing a rate sends the category back to "Not set". Past trades keep their snapshot.
async function removeCategoryCommission(categoryId, actorUserId) {
  return prisma.$transaction(async (tx) => {
    const category = await findCategoryOrThrow(tx, categoryId);
    const existing = await tx.categoryCommission.findUnique({ where: { categoryId } });
    if (!existing) {
      throw new AppError('This category has no commission rate set', 404);
    }

    await tx.categoryCommission.delete({ where: { categoryId } });

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'CATEGORY_COMMISSION_REMOVED',
        entity: 'CategoryCommission',
        entityId: existing.id,
        before: serializeCategoryCommission({ ...existing, categoryName: category.name }),
        after: null,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Trade snapshot
// ---------------------------------------------------------------------------

// Decides a trade's commission at confirm time. Meant to be called inside the same
// transaction that creates the Trade row, and spread into its data:
//   const commission = await resolveTradeCommission(tx, {...});
//   tx.trade.create({ data: { ...tradeFields, ...commission } });
//
//   Self / free-text broker  -> status none,    amount 0
//   listed broker, no rate   -> status not_set, nothing calculated (never 0)
//   listed broker, rate set  -> status set,     amount calculated and locked in
async function resolveTradeCommission(db, { brokerId, isSelf, commodityId, finalPrice, quantityBags }) {
  if (isSelf || !brokerId) {
    return {
      commissionStatus: 'none',
      commissionType: null,
      commissionRate: null,
      commissionAmount: new Decimal(0),
      commissionCategoryId: null,
    };
  }

  let categoryId = null;
  if (commodityId) {
    const commodity = await db.commodity.findUnique({ where: { id: commodityId }, select: { categoryId: true } });
    categoryId = commodity ? commodity.categoryId : null;
  }

  const rate = categoryId ? await db.categoryCommission.findUnique({ where: { categoryId } }) : null;
  if (!rate) {
    return {
      commissionStatus: 'not_set',
      commissionType: null,
      commissionRate: null,
      commissionAmount: null,
      commissionCategoryId: categoryId,
    };
  }

  return {
    commissionStatus: 'set',
    commissionType: rate.commissionType,
    commissionRate: rate.rate,
    commissionAmount: calculateCommissionAmount({
      commissionType: rate.commissionType,
      rate: rate.rate,
      finalPrice,
      quantityBags,
    }),
    commissionCategoryId: categoryId,
  };
}

// An admin fills in the commission of a trade that was confirmed as "not_set".
// Records who and when. The status check lives in the UPDATE's WHERE, so two admins
// filling the same trade at once can't both win — the second gets a 409.
async function setTradeCommission(tradeId, body, actorUserId) {
  validateUuid(tradeId);
  const { commissionType, commissionRate } = buildCommissionValue(body);

  return prisma.$transaction(async (tx) => {
    const trade = await tx.trade.findUnique({
      where: { id: tradeId },
      include: { commodity: { select: { categoryId: true } } },
    });
    if (!trade) {
      throw new AppError('Trade not found', 404);
    }
    if (trade.status === 'cancelled') {
      throw new AppError('Cannot set the commission of a cancelled trade', 409);
    }
    if (trade.commissionStatus !== 'not_set') {
      throw new AppError(
        trade.commissionStatus === 'set'
          ? 'The commission of this trade is already set'
          : 'This trade has no commission (Self / free-text broker)',
        409
      );
    }

    const categoryId = trade.commissionCategoryId || (trade.commodity && trade.commodity.categoryId);
    if (!categoryId) {
      throw new AppError('This trade has no commodity category, so a commission cannot be set', 409);
    }

    const amount = calculateCommissionAmount({
      commissionType,
      rate: commissionRate,
      finalPrice: trade.finalPrice,
      quantityBags: trade.quantityBags,
    });

    const { count } = await tx.trade.updateMany({
      where: { id: tradeId, commissionStatus: 'not_set' },
      data: {
        commissionStatus: 'set',
        commissionType,
        commissionRate,
        commissionAmount: amount,
        commissionCategoryId: categoryId,
        commissionSetById: actorUserId,
        commissionSetAt: new Date(),
      },
    });
    if (count === 0) {
      throw new AppError('The commission of this trade was just set by someone else', 409);
    }

    const updated = await tx.trade.findUnique({ where: { id: tradeId } });

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'TRADE_COMMISSION_SET',
        entity: 'Trade',
        entityId: tradeId,
        before: tradeCommissionSnapshot(trade),
        after: tradeCommissionSnapshot(updated),
      },
    });

    return {
      id: updated.id,
      ...tradeCommissionSnapshot(updated),
    };
  });
}

module.exports = {
  calculateCommissionAmount,
  listCategoryCommissions,
  setCategoryCommission,
  removeCategoryCommission,
  resolveTradeCommission,
  setTradeCommission,
};
