const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { validateUuid } = require('../lib/validators');
const { AUDIT_CATEGORIES } = require('./audit.validation');

const ACTOR_SELECT = { id: true, name: true, phone: true, firmName: true, roles: true };

// Entities whose before/after snapshot carries the owning user's id as `userId`
// (a listing's owner, a broker's linked app account).
const ENTITIES_WITH_USER_ID = ['Listing', 'Broker'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Generic diff: names of the top-level keys whose value differs between the
// two snapshots. Knows nothing about any entity, so new modules need no change.
// A create (before null) or delete (after null) reports every key of the side
// that exists.
function changedFields(before, after) {
  const b = isPlainObject(before) ? before : {};
  const a = isPlainObject(after) ? after : {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  return [...keys].filter((key) => JSON.stringify(b[key]) !== JSON.stringify(a[key]));
}

// Rows about one user's data: the user row itself, or a listing/broker whose
// snapshot (either side, so creates and withdrawals both match) names them.
function targetUserCondition(userId) {
  return {
    OR: [
      { entity: 'AppUser', entityId: userId },
      ...ENTITIES_WITH_USER_ID.map((entity) => ({
        entity,
        OR: [
          { after: { path: ['userId'], equals: userId } },
          { before: { path: ['userId'], equals: userId } },
        ],
      })),
    ],
  };
}

// Every filter is its own AND clause, so two filters on the same column
// (entity + category, q + targetUserId) narrow together instead of one
// overwriting the other.
function buildWhere(filters) {
  const and = [];
  if (filters.actorUserId) and.push({ actorUserId: filters.actorUserId });
  if (filters.actions) and.push({ action: { in: filters.actions } });
  if (filters.entity) and.push({ entity: filters.entity });
  if (filters.entityId) and.push({ entityId: filters.entityId });
  if (filters.categoryEntities) and.push({ entity: { in: filters.categoryEntities } });
  if (filters.actorRole) and.push({ actor: { roles: { has: filters.actorRole } } });
  if (filters.onBehalf) and.push({ action: { endsWith: '_BY_ADMIN' } });
  if (filters.targetUserId) and.push(targetUserCondition(filters.targetUserId));

  if (filters.from || filters.to) {
    const createdAt = {};
    if (filters.from) createdAt.gte = filters.from;
    if (filters.to) createdAt.lte = filters.to;
    and.push({ createdAt });
  }

  if (filters.q) {
    const contains = { contains: filters.q, mode: 'insensitive' };
    and.push({
      OR: [
        { action: contains },
        { entityId: contains },
        { actor: { OR: [{ name: contains }, { firmName: contains }, { phone: contains }] } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

// List rows omit before/after (they can be large, e.g. freight bulk upload);
// `changedFields` gives a one-line summary instead. Full snapshots come from
// getAuditLog.
async function listAuditLogs({ skip, take, filters }) {
  const where = buildWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
      include: { actor: { select: ACTOR_SELECT } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  const data = rows.map(({ before, after, ...rest }) => ({
    ...rest,
    changedFields: changedFields(before, after),
  }));
  return { data, total };
}

async function getAuditLog(id) {
  validateUuid(id, 'id');
  const row = await prisma.auditLog.findUnique({
    where: { id },
    include: { actor: { select: ACTOR_SELECT } },
  });
  if (!row) {
    throw new AppError('Audit log entry not found', 404);
  }
  return { ...row, changedFields: changedFields(row.before, row.after) };
}

// Values for the admin panel's filter dropdowns.
async function getFilterOptions() {
  const [actions, entities, actorIds] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['actorUserId'], select: { actorUserId: true } }),
  ]);

  const actors = await prisma.appUser.findMany({
    where: { id: { in: actorIds.map((a) => a.actorUserId) } },
    select: ACTOR_SELECT,
    orderBy: { name: 'asc' },
  });

  return {
    actions: actions.map((a) => a.action),
    entities: entities.map((e) => e.entity),
    actors,
    categories: Object.keys(AUDIT_CATEGORIES),
  };
}

module.exports = { listAuditLogs, getAuditLog, getFilterOptions, changedFields, buildWhere };
