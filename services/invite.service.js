const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { validatePhone, validateUuid } = require('../lib/validators');
const { buildContainsFilter, buildDateRangeFilter } = require('../lib/filters');

// What an admin may pick when inviting by hand. A broker is never invited here:
// the invite is created automatically when the admin adds the broker
// (services/broker.service.js), so a broker cannot be sent a second, stray invite.
const ALLOWED_ROLE_HINTS = ['buyer', 'seller'];
// What the invite list can be filtered by — includes the automatic broker invites.
const LISTABLE_ROLE_HINTS = [...ALLOWED_ROLE_HINTS, 'broker'];
const VALID_STATUSES = ['pending', 'accepted', 'revoked'];

const PENDING_INVITE_TAKEN = 'An invite for this phone number is already pending';

function normalizeRoleHint(roleHint) {
  const normalized = typeof roleHint === 'string' ? roleHint.toLowerCase() : roleHint;
  if (!ALLOWED_ROLE_HINTS.includes(normalized)) {
    throw new AppError(`roleHint must be one of: ${ALLOWED_ROLE_HINTS.join(', ')}`, 400);
  }
  return normalized;
}

// Creates a pending invite and its INVITE_SENT audit row on `db` (a transaction
// client, so the caller can make it atomic with whatever else it is doing).
// Callers are responsible for checking the phone is free first.
async function createPendingInvite(db, { phone, roleHint, invitedById }) {
  const invite = await db.invite.create({ data: { phone, roleHint, invitedById } });

  await db.auditLog.create({
    data: {
      actorUserId: invitedById,
      action: 'INVITE_SENT',
      entity: 'Invite',
      entityId: invite.id,
      before: null,
      after: invite,
    },
  });

  return invite;
}

// Revokes every pending invite on `phone` for `roleHint` (there is at most one —
// the DB allows one open invite per phone) and writes INVITE_CANCELLED for each.
async function revokePendingInvites(db, { phone, roleHint, actorUserId }) {
  const pending = await db.invite.findMany({ where: { phone, roleHint, status: 'pending' } });

  for (const invite of pending) {
    const updated = await db.invite.update({ where: { id: invite.id }, data: { status: 'revoked' } });
    await db.auditLog.create({
      data: {
        actorUserId,
        action: 'INVITE_CANCELLED',
        entity: 'Invite',
        entityId: invite.id,
        before: invite,
        after: updated,
      },
    });
  }

  return pending.length;
}

async function sendInvitation({ phone, roleHint, actorUserId }) {
  const normalizedPhone = validatePhone(phone);
  const normalizedRoleHint = normalizeRoleHint(roleHint);

  const existingPending = await prisma.invite.findFirst({
    where: { phone: normalizedPhone, status: 'pending' },
  });
  if (existingPending) {
    throw new AppError(PENDING_INVITE_TAKEN, 409);
  }

  try {
    return await prisma.$transaction((tx) =>
      createPendingInvite(tx, { phone: normalizedPhone, roleHint: normalizedRoleHint, invitedById: actorUserId })
    );
  } catch (err) {
    if (err.code === 'P2002') {
      throw new AppError(PENDING_INVITE_TAKEN, 409);
    }
    throw err;
  }
}

async function listInvitations({ status, phone, roleHint, createdFrom, createdTo, skip, take }) {
  if (status && !VALID_STATUSES.includes(status)) {
    throw new AppError(`status must be one of: ${VALID_STATUSES.join(', ')}`, 400);
  }
  if (roleHint && !LISTABLE_ROLE_HINTS.includes(roleHint)) {
    throw new AppError(`roleHint must be one of: ${LISTABLE_ROLE_HINTS.join(', ')}`, 400);
  }

  const phoneFilter = buildContainsFilter(phone);
  const createdAtFilter = buildDateRangeFilter(createdFrom, createdTo, 'created');

  const where = {
    ...(status ? { status } : {}),
    ...(roleHint ? { roleHint } : {}),
    ...(phoneFilter ? { phone: phoneFilter } : {}),
    ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.invite.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.invite.count({ where }),
  ]);
  return { data, total };
}

async function cancelInvitation({ id, actorUserId }) {
  validateUuid(id);

  return prisma.$transaction(async (tx) => {
    const invite = await tx.invite.findUnique({ where: { id } });
    if (!invite) {
      throw new AppError('Invite not found', 404);
    }
    if (invite.status !== 'pending') {
      throw new AppError('Only pending invites can be cancelled', 409);
    }
    // A broker invite is tied to their broker record; cancelling it on its own
    // would leave an active broker nobody can log in as. Deactivate the broker instead.
    if (invite.roleHint === 'broker') {
      throw new AppError('A broker invite is managed with the broker — deactivate the broker instead', 409);
    }

    const updated = await tx.invite.update({
      where: { id },
      data: { status: 'revoked' },
    });

    await tx.auditLog.create({
      data: {
        actorUserId,
        action: 'INVITE_CANCELLED',
        entity: 'Invite',
        entityId: invite.id,
        before: invite,
        after: updated,
      },
    });

    return updated;
  });
}

module.exports = {
  sendInvitation,
  listInvitations,
  cancelInvitation,
  createPendingInvite,
  revokePendingInvites,
};
