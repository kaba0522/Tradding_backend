const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { validateUuid } = require('../lib/validators');

const ACTOR_SELECT = { id: true, name: true, phone: true, firmName: true };

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

function buildWhere(filters) {
  const where = {};
  if (filters.actorUserId) where.actorUserId = filters.actorUserId;
  if (filters.actions) where.action = { in: filters.actions };
  if (filters.entity) where.entity = filters.entity;
  if (filters.entityId) where.entityId = filters.entityId;

  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = filters.from;
    if (filters.to) where.createdAt.lte = filters.to;
  }

  if (filters.q) {
    where.OR = [
      { action: { contains: filters.q, mode: 'insensitive' } },
      { entityId: { contains: filters.q, mode: 'insensitive' } },
    ];
  }
  return where;
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
  };
}

module.exports = { listAuditLogs, getAuditLog, getFilterOptions, changedFields };
