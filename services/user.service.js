const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { buildContainsFilter } = require('../lib/filters');
const { buildProfileUpdateData } = require('./user.validation');

async function getOwnProfile(userId) {
  const user = await prisma.appUser.findUnique({ where: { id: userId } });
  if (!user) {
    throw new AppError('User not found', 404);
  }
  return user;
}

// Covers both "complete profile after invite" and "edit profile later" — same
// operation, since the AppUser row already exists from OTP verification
// (phone/roles/status only — see services/auth.service.js:verifyOtp).
// phone/roles/status/id/invitedById/tosAccepted* are never accepted here.
async function updateOwnProfile(userId, body) {
  const data = buildProfileUpdateData(body);

  // A seller's default payment terms is the fallback every new listing copies from,
  // so it can be changed (0 included) but never cleared.
  if (data.defaultPaymentTerms === null) {
    const current = await prisma.appUser.findUnique({ where: { id: userId }, select: { roles: true } });
    if (current && current.roles.includes('seller')) {
      throw new AppError('defaultPaymentTerms cannot be cleared for a seller', 400);
    }
  }

  const user = await prisma.appUser.update({
    where: { id: userId },
    data,
  });

  return user;
}

const LIST_ROLES = ['buyer', 'seller', 'broker', 'admin'];
const LIST_STATUSES = ['active', 'suspended', 'deactivated'];
const LIST_SORTS = ['name', 'lastLogin'];
const DAY_MS = 24 * 60 * 60 * 1000;

const LIST_SELECT = {
  id: true,
  name: true,
  firmName: true,
  phone: true,
  roles: true,
  city: true,
  status: true,
  defaultPaymentTerms: true,
};
// id as the last key keeps the order stable between pages
const NAME_ORDER = [{ firmName: { sort: 'asc', nulls: 'last' } }, { name: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }];

function parseOptionalDate(value, fieldName) {
  if (value === undefined || value === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${fieldName} must be a valid date`, 400);
  }
  return date;
}

// Last login = the newest refresh token. One is issued on every OTP login
// (auth.service issueTokenPair) and none are ever deleted. A token refresh does
// not issue one, so this is the last sign-in, not the last time the app was used.
function buildLastLoginFilter({ lastLoginFrom, lastLoginTo, inactiveDays }, now = new Date()) {
  const from = parseOptionalDate(lastLoginFrom, 'lastLoginFrom');
  const to = parseOptionalDate(lastLoginTo, 'lastLoginTo');
  if (from && to && from > to) {
    throw new AppError('lastLoginFrom must not be after lastLoginTo', 400);
  }

  let inactiveSince;
  if (inactiveDays !== undefined && inactiveDays !== '') {
    const days = Number(inactiveDays);
    if (!Number.isInteger(days) || days < 1) {
      throw new AppError('inactiveDays must be a positive integer', 400);
    }
    inactiveSince = new Date(now.getTime() - days * DAY_MS);
  }

  const conditions = [];
  // Logged in at or after `from`.
  if (from) conditions.push({ refreshTokens: { some: { createdAt: { gte: from } } } });
  // Last login at or before `to`: no login after it.
  if (to) conditions.push({ refreshTokens: { none: { createdAt: { gt: to } } } });
  // No login within the last N days.
  if (inactiveSince) conditions.push({ refreshTokens: { none: { createdAt: { gt: inactiveSince } } } });
  return conditions;
}

async function lastLoginByUser(userIds) {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.refreshToken.groupBy({
    by: ['userId'],
    where: { userId: { in: userIds } },
    _max: { createdAt: true },
  });
  return new Map(rows.map((r) => [r.userId, r._max.createdAt]));
}

// GET /users (admin-only): feeds the admin panel's "create for which user?" picker
// and the users table. Only people who have logged in at least once exist here — an
// app_user row is created on first OTP login; invited-but-never-logged-in phones
// live in `invite`. Without ?role, lists users who are a buyer or a seller
// (broker-only and admin-only accounts can't own listings, so they'd only clutter
// the picker).
async function listUsers({ search, role, status, sort, lastLoginFrom, lastLoginTo, inactiveDays, skip, take }) {
  if (role !== undefined && !LIST_ROLES.includes(role)) {
    throw new AppError(`role must be one of: ${LIST_ROLES.join(', ')}`, 400);
  }
  const statusFilter = status === undefined ? 'active' : status;
  if (!LIST_STATUSES.includes(statusFilter)) {
    throw new AppError(`status must be one of: ${LIST_STATUSES.join(', ')}`, 400);
  }
  const sortBy = sort === undefined || sort === '' ? 'name' : sort;
  if (!LIST_SORTS.includes(sortBy)) {
    throw new AppError(`sort must be one of: ${LIST_SORTS.join(', ')}`, 400);
  }
  const searchFilter = buildContainsFilter(search);
  const lastLoginConditions = buildLastLoginFilter({ lastLoginFrom, lastLoginTo, inactiveDays });

  const where = {
    status: statusFilter,
    roles: role ? { has: role } : { hasSome: ['buyer', 'seller'] },
    ...(searchFilter
      ? { OR: [{ name: searchFilter }, { firmName: searchFilter }, { phone: searchFilter }] }
      : {}),
    ...(lastLoginConditions.length ? { AND: lastLoginConditions } : {}),
  };

  let users;
  let total;
  if (sortBy === 'lastLogin') {
    // Prisma can't order by the newest row of a relation, so rank the matching
    // ids in memory (an invite-only network has hundreds of users, not millions)
    // and load just the requested page.
    const matching = await prisma.appUser.findMany({ where, select: { id: true }, orderBy: NAME_ORDER });
    const lastLogins = await lastLoginByUser(matching.map((u) => u.id));
    const time = (id) => (lastLogins.get(id) ? lastLogins.get(id).getTime() : -Infinity);
    // Array sort is stable, so equal times keep the name order from the query.
    const pageIds = matching
      .map((u) => u.id)
      .sort((a, b) => time(b) - time(a))
      .slice(skip, skip + take);
    const rows = await prisma.appUser.findMany({ where: { id: { in: pageIds } }, select: LIST_SELECT });
    const byId = new Map(rows.map((u) => [u.id, u]));
    users = pageIds.map((id) => byId.get(id)).filter(Boolean);
    total = matching.length;
  } else {
    [users, total] = await Promise.all([
      prisma.appUser.findMany({ where, select: LIST_SELECT, orderBy: NAME_ORDER, skip, take }),
      prisma.appUser.count({ where }),
    ]);
  }

  const lastLogins = await lastLoginByUser(users.map((u) => u.id));
  const data = users.map((u) => ({ ...u, lastLoginAt: lastLogins.get(u.id) || null }));
  return { data, total };
}

module.exports = { getOwnProfile, updateOwnProfile, listUsers, buildLastLoginFilter };
