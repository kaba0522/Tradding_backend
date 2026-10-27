const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { validateUuid } = require('../lib/validators');
const { buildContainsFilter } = require('../lib/filters');
const { buildBrokerCreateData, buildBrokerUpdateData, parseActiveFilter } = require('./broker.validation');

const USER_SUMMARY_SELECT = { id: true, name: true, phone: true };
const BROKER_INCLUDE = {
  createdBy: { select: USER_SUMMARY_SELECT },
  updatedBy: { select: USER_SUMMARY_SELECT },
};

function toNumberOrNull(decimal) {
  return decimal === null || decimal === undefined ? null : Number(decimal);
}

function serializeBroker(broker) {
  return { ...broker, commissionRate: toNumberOrNull(broker.commissionRate) };
}

// A phone already on a broker — active or not — can't be reused: an inactive
// broker should be reactivated instead, so their trade history stays on one row.
async function assertPhoneAvailable(phone, excludeId) {
  const clash = await prisma.broker.findUnique({ where: { phone } });
  if (clash && clash.id !== excludeId) {
    throw phoneTakenError(clash);
  }
}

function phoneTakenError(clash) {
  const message = clash && !clash.active
    ? 'An inactive broker with this phone number already exists — reactivate it instead'
    : 'A broker with this phone number already exists';
  return new AppError(message, 409);
}

async function findBrokerOrThrow(id) {
  validateUuid(id);
  const broker = await prisma.broker.findUnique({ where: { id } });
  if (!broker) {
    throw new AppError('Broker not found', 404);
  }
  return broker;
}

async function createBroker(body, actorUserId) {
  const data = buildBrokerCreateData(body);
  await assertPhoneAvailable(data.phone);

  let broker;
  try {
    broker = await prisma.broker.create({
      data: { ...data, createdById: actorUserId },
      include: BROKER_INCLUDE,
    });
  } catch (err) {
    // Lost a race with a concurrent create on the same phone.
    if (err.code === 'P2002') {
      throw phoneTakenError(await prisma.broker.findUnique({ where: { phone: data.phone } }));
    }
    throw err;
  }

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'BROKER_CREATED',
      entity: 'Broker',
      entityId: broker.id,
      before: null,
      after: broker,
    },
  });

  return serializeBroker(broker);
}

// `search` matches name or phone (case-insensitive contains), so typing either
// a name or part of a number finds the broker.
async function listBrokers({ search, active, skip, take } = {}) {
  const activeFilter = parseActiveFilter(active);
  const searchFilter = buildContainsFilter(search);

  const where = {
    ...(activeFilter !== undefined ? { active: activeFilter } : {}),
    ...(searchFilter ? { OR: [{ name: searchFilter }, { phone: searchFilter }] } : {}),
  };

  const [brokers, total] = await Promise.all([
    prisma.broker.findMany({
      where,
      include: BROKER_INCLUDE,
      // id as the last key keeps the order stable between pages
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip,
      take,
    }),
    prisma.broker.count({ where }),
  ]);

  return { data: brokers.map(serializeBroker), total };
}

async function getBrokerById(id) {
  validateUuid(id);
  const broker = await prisma.broker.findUnique({
    where: { id },
    include: { ...BROKER_INCLUDE, _count: { select: { trades: true } } },
  });
  if (!broker) {
    throw new AppError('Broker not found', 404);
  }

  const { _count, ...rest } = broker;
  return { ...serializeBroker(rest), tradeCount: _count.trades };
}

async function updateBroker(id, body, actorUserId) {
  const existing = await findBrokerOrThrow(id);
  const data = buildBrokerUpdateData(body, existing);

  if (data.phone !== undefined && data.phone !== existing.phone) {
    await assertPhoneAvailable(data.phone, id);
  }

  let broker;
  try {
    broker = await prisma.broker.update({
      where: { id },
      data: { ...data, updatedById: actorUserId, updatedAt: new Date() },
      include: BROKER_INCLUDE,
    });
  } catch (err) {
    if (err.code === 'P2002') {
      throw phoneTakenError(await prisma.broker.findUnique({ where: { phone: data.phone } }));
    }
    throw err;
  }

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'BROKER_UPDATED',
      entity: 'Broker',
      entityId: id,
      before: existing,
      after: broker,
    },
  });

  return serializeBroker(broker);
}

// Soft delete / restore. Brokers are never hard-deleted (see the Broker model in
// schema.prisma): past trades keep pointing at the row, it just leaves the list.
async function setBrokerActive(id, active, actorUserId) {
  const existing = await findBrokerOrThrow(id);
  if (existing.active === active) {
    throw new AppError(active ? 'Broker is already active' : 'Broker is already inactive', 409);
  }

  const broker = await prisma.broker.update({
    where: { id },
    data: { active, updatedById: actorUserId, updatedAt: new Date() },
    include: BROKER_INCLUDE,
  });

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: active ? 'BROKER_REACTIVATED' : 'BROKER_DEACTIVATED',
      entity: 'Broker',
      entityId: id,
      before: existing,
      after: broker,
    },
  });

  return serializeBroker(broker);
}

function deactivateBroker(id, actorUserId) {
  return setBrokerActive(id, false, actorUserId);
}

function reactivateBroker(id, actorUserId) {
  return setBrokerActive(id, true, actorUserId);
}

module.exports = {
  createBroker,
  listBrokers,
  getBrokerById,
  updateBroker,
  deactivateBroker,
  reactivateBroker,
};
