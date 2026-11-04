const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { validateUuid } = require('../lib/validators');
const { buildContainsFilter } = require('../lib/filters');
const { buildBrokerCreateData, buildBrokerUpdateData, parseActiveFilter } = require('./broker.validation');
const { createPendingInvite, revokePendingInvites } = require('./invite.service');

const USER_SUMMARY_SELECT = { id: true, name: true, phone: true };
const BROKER_INCLUDE = {
  createdBy: { select: USER_SUMMARY_SELECT },
  updatedBy: { select: USER_SUMMARY_SELECT },
};

const PENDING_INVITE_TAKEN = 'An invite for this phone number is already pending';
const PHONE_BELONGS_TO_USER = 'This phone number belongs to an existing user — a broker must use a separate number';

// ---------------------------------------------------------------------------
// Phone rules
// ---------------------------------------------------------------------------

function phoneTakenError(clash) {
  const message = clash && !clash.active
    ? 'An inactive broker with this phone number already exists — reactivate it instead'
    : 'A broker with this phone number already exists';
  return new AppError(message, 409);
}

// A broker is always a different person from every other user, so their phone must
// not already be on another broker, on an app user (admin, buyer, seller...), or on
// a pending invite. Runs on `db` so it can sit inside the caller's transaction.
// `excludeBrokerId` skips the broker being edited; `checkBrokers: false` skips the
// broker-table check when only the user / invite sides matter (reactivation).
async function assertPhoneAvailable(db, phone, { excludeBrokerId, checkBrokers = true } = {}) {
  if (checkBrokers) {
    const clash = await db.broker.findUnique({ where: { phone } });
    if (clash && clash.id !== excludeBrokerId) {
      throw phoneTakenError(clash);
    }
  }

  const user = await db.appUser.findUnique({ where: { phone }, select: { id: true } });
  if (user) {
    throw new AppError(PHONE_BELONGS_TO_USER, 409);
  }

  const pending = await db.invite.findFirst({ where: { phone, status: 'pending' }, select: { id: true } });
  if (pending) {
    throw new AppError(PENDING_INVITE_TAKEN, 409);
  }
}

// A concurrent request can win the race the checks above can't see. The DB's unique
// constraints (broker.phone, one open invite per phone, app_user.phone) then fire a
// P2002; re-run the checks, now outside the failed transaction, to say which one.
async function rethrowPhoneClash(err, phone, excludeBrokerId) {
  if (err.code === 'P2002' && phone) {
    await assertPhoneAvailable(prisma, phone, { excludeBrokerId });
    throw new AppError('This phone number was just taken — try again', 409);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// inactive       -> deactivated by an admin
// logged_in      -> the broker has accepted the invite and has an app account
// invite_pending -> invited, hasn't logged in yet
// no_invite      -> active but never invited (added before invites were automatic);
//                   deactivate and reactivate to send one
async function withLoginStatus(brokers) {
  const waiting = brokers.filter((b) => b.active && !b.userId).map((b) => b.phone);
  const invited = new Set();
  if (waiting.length > 0) {
    const pending = await prisma.invite.findMany({
      where: { phone: { in: waiting }, roleHint: 'broker', status: 'pending' },
      select: { phone: true },
    });
    pending.forEach((invite) => invited.add(invite.phone));
  }

  return brokers.map((broker) => {
    let loginStatus;
    if (!broker.active) loginStatus = 'inactive';
    else if (broker.userId) loginStatus = 'logged_in';
    else if (invited.has(broker.phone)) loginStatus = 'invite_pending';
    else loginStatus = 'no_invite';
    return { ...broker, loginStatus };
  });
}

async function findBrokerOrThrow(db, id) {
  validateUuid(id);
  const broker = await db.broker.findUnique({ where: { id } });
  if (!broker) {
    throw new AppError('Broker not found', 404);
  }
  return broker;
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

  return { data: await withLoginStatus(brokers), total };
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
  const [withStatus] = await withLoginStatus([rest]);
  return { ...withStatus, tradeCount: _count.trades };
}

// The trade-accept dropdown: every active broker, whether or not they have accepted
// their invite yet. Id and name only — buyers and sellers never see a phone number.
function listBrokerOptions() {
  return prisma.broker.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
}

// ---------------------------------------------------------------------------
// Admin writes — each change and its audit rows commit together or not at all
// ---------------------------------------------------------------------------

async function createBroker(body, actorUserId) {
  const data = buildBrokerCreateData(body);

  try {
    const broker = await prisma.$transaction(async (tx) => {
      await assertPhoneAvailable(tx, data.phone);

      const created = await tx.broker.create({
        data: { ...data, createdById: actorUserId },
        include: BROKER_INCLUDE,
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'BROKER_CREATED',
          entity: 'Broker',
          entityId: created.id,
          before: null,
          after: created,
        },
      });

      // The broker can log in as soon as they are added: this invite is what lets
      // their number through the invite-only login (services/auth.service.js).
      await createPendingInvite(tx, { phone: data.phone, roleHint: 'broker', invitedById: actorUserId });

      return created;
    });

    const [withStatus] = await withLoginStatus([broker]);
    return withStatus;
  } catch (err) {
    return rethrowPhoneClash(err, data.phone);
  }
}

async function updateBroker(id, body, actorUserId) {
  const data = buildBrokerUpdateData(body);
  const phoneChange = data.phone;

  try {
    const broker = await prisma.$transaction(async (tx) => {
      const existing = await findBrokerOrThrow(tx, id);
      const phoneChanged = phoneChange !== undefined && phoneChange !== existing.phone;

      if (phoneChanged) {
        // Once logged in, the phone is the broker's login identity.
        if (existing.userId) {
          throw new AppError('The phone number cannot be changed after the broker has logged in', 409);
        }
        await assertPhoneAvailable(tx, phoneChange, { excludeBrokerId: id });
      } else {
        delete data.phone;
      }

      const updated = await tx.broker.update({
        where: { id },
        data: { ...data, updatedById: actorUserId, updatedAt: new Date() },
        include: BROKER_INCLUDE,
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'BROKER_UPDATED',
          entity: 'Broker',
          entityId: id,
          before: existing,
          after: updated,
        },
      });

      // Not logged in yet: the invite is for the old number, so move it to the new one.
      // An inactive broker has no invite; reactivation sends one.
      if (phoneChanged && existing.active) {
        await revokePendingInvites(tx, { phone: existing.phone, roleHint: 'broker', actorUserId });
        await createPendingInvite(tx, { phone: phoneChange, roleHint: 'broker', invitedById: actorUserId });
      }

      return updated;
    });

    const [withStatus] = await withLoginStatus([broker]);
    return withStatus;
  } catch (err) {
    return rethrowPhoneClash(err, phoneChange, id);
  }
}

// Soft delete / restore. Brokers are never hard-deleted (see the Broker model in
// schema.prisma): past trades keep pointing at the row, it just leaves the dropdown.
//   deactivate -> a pending invite is revoked; a broker who already logged in is suspended
//   reactivate -> a suspended account comes back; a broker who never logged in gets a new invite
async function setBrokerActive(id, active, actorUserId) {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await findBrokerOrThrow(tx, id);
      if (existing.active === active) {
        throw new AppError(active ? 'Broker is already active' : 'Broker is already inactive', 409);
      }

      // Reactivating a broker who never logged in re-sends their invite, so the phone
      // must still be free of other users and invites.
      if (active && !existing.userId) {
        await assertPhoneAvailable(tx, existing.phone, { excludeBrokerId: id, checkBrokers: false });
      }

      const updated = await tx.broker.update({
        where: { id },
        data: { active, updatedById: actorUserId, updatedAt: new Date() },
        include: BROKER_INCLUDE,
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: active ? 'BROKER_REACTIVATED' : 'BROKER_DEACTIVATED',
          entity: 'Broker',
          entityId: id,
          before: existing,
          after: updated,
        },
      });

      if (existing.userId) {
        await syncBrokerUserStatus(tx, existing.userId, active, actorUserId);
      } else if (active) {
        await createPendingInvite(tx, { phone: existing.phone, roleHint: 'broker', invitedById: actorUserId });
      } else {
        await revokePendingInvites(tx, { phone: existing.phone, roleHint: 'broker', actorUserId });
      }

      return updated;
    });

    const [withStatus] = await withLoginStatus([result]);
    return withStatus;
  } catch (err) {
    if (active && err.code === 'P2002') {
      throw new AppError(PENDING_INVITE_TAKEN, 409);
    }
    throw err;
  }
}

// Suspends a deactivated broker's app account (so they are signed out of the app and
// cannot log back in) and restores it on reactivation. An account an admin suspended
// for some other reason is left alone on reactivation.
async function syncBrokerUserStatus(tx, userId, brokerActive, actorUserId) {
  const user = await tx.appUser.findUnique({ where: { id: userId } });
  if (!user) return;

  const from = brokerActive ? 'suspended' : 'active';
  const to = brokerActive ? 'active' : 'suspended';
  if (user.status !== from) return;

  const updated = await tx.appUser.update({ where: { id: userId }, data: { status: to, updatedAt: new Date() } });
  await tx.auditLog.create({
    data: {
      actorUserId,
      action: brokerActive ? 'BROKER_USER_REACTIVATED' : 'BROKER_USER_SUSPENDED',
      entity: 'AppUser',
      entityId: userId,
      before: { status: user.status },
      after: { status: updated.status },
    },
  });
}

function deactivateBroker(id, actorUserId) {
  return setBrokerActive(id, false, actorUserId);
}

function reactivateBroker(id, actorUserId) {
  return setBrokerActive(id, true, actorUserId);
}

// ---------------------------------------------------------------------------
// First login
// ---------------------------------------------------------------------------

// Called from the login transaction when a broker's invite is accepted: ties the
// new app account to the broker row (matched by the invited phone) so the token's
// user id can later be traced to trade.broker_id. The actor is the broker themself.
async function linkBrokerToUser(tx, user) {
  const broker = await tx.broker.findUnique({ where: { phone: user.phone } });
  if (!broker || broker.userId) {
    throw new AppError('No broker is waiting for this number', 409);
  }
  if (!broker.active) {
    throw new AppError('Account is not active', 403);
  }

  const linked = await tx.broker.update({
    where: { id: broker.id },
    data: { userId: user.id, updatedAt: new Date() },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: user.id,
      action: 'BROKER_USER_LINKED',
      entity: 'Broker',
      entityId: broker.id,
      before: broker,
      after: linked,
    },
  });

  return linked;
}

// ---------------------------------------------------------------------------
// A broker's own trades (read-only)
// ---------------------------------------------------------------------------

const PARTY_SELECT = { id: true, name: true, firmName: true, phone: true, city: true };
const TRADE_INCLUDE = {
  buyer: { select: PARTY_SELECT },
  seller: { select: PARTY_SELECT },
  commodity: { select: { id: true, name: true, category: { select: { id: true, name: true } } } },
};

function toNumberOrNull(decimal) {
  return decimal === null || decimal === undefined ? null : Number(decimal);
}

function serializeTrade(trade) {
  return {
    ...trade,
    finalPrice: toNumberOrNull(trade.finalPrice),
    commissionRate: toNumberOrNull(trade.commissionRate),
    commissionAmount: toNumberOrNull(trade.commissionAmount),
  };
}

async function findOwnBrokerOrThrow(userId) {
  const broker = await prisma.broker.findUnique({ where: { userId } });
  if (!broker) {
    throw new AppError('No broker profile is linked to this account', 404);
  }
  return broker;
}

// Trades where a buyer or seller picked this broker from the dropdown. The commission
// amount is included for now; hide it here when it should stop being shown to brokers.
async function listOwnTrades(userId, { status, skip, take }) {
  if (status !== undefined && !['confirmed', 'cancelled'].includes(status)) {
    throw new AppError('status must be one of: confirmed, cancelled', 400);
  }
  const broker = await findOwnBrokerOrThrow(userId);
  const where = { brokerId: broker.id, ...(status ? { status } : {}) };

  const [trades, total] = await Promise.all([
    prisma.trade.findMany({
      where,
      include: TRADE_INCLUDE,
      orderBy: [{ confirmedAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
    }),
    prisma.trade.count({ where }),
  ]);

  return { data: trades.map(serializeTrade), total };
}

async function getOwnTrade(userId, tradeId) {
  validateUuid(tradeId);
  const broker = await findOwnBrokerOrThrow(userId);
  const trade = await prisma.trade.findFirst({
    where: { id: tradeId, brokerId: broker.id },
    include: TRADE_INCLUDE,
  });
  if (!trade) {
    throw new AppError('Trade not found', 404);
  }
  return serializeTrade(trade);
}

module.exports = {
  createBroker,
  listBrokers,
  getBrokerById,
  listBrokerOptions,
  updateBroker,
  deactivateBroker,
  reactivateBroker,
  linkBrokerToUser,
  listOwnTrades,
  getOwnTrade,
};
