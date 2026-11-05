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

// GET /users (admin-only): feeds the admin panel's "create for which user?" picker.
// Only people who have logged in at least once exist here — an app_user row is
// created on first OTP login; invited-but-never-logged-in phones live in `invite`.
// Without ?role, lists users who are a buyer or a seller (broker-only and admin-only
// accounts can't own listings, so they'd only clutter the picker).
async function listUsers({ search, role, status, skip, take }) {
  if (role !== undefined && !LIST_ROLES.includes(role)) {
    throw new AppError(`role must be one of: ${LIST_ROLES.join(', ')}`, 400);
  }
  const statusFilter = status === undefined ? 'active' : status;
  if (!LIST_STATUSES.includes(statusFilter)) {
    throw new AppError(`status must be one of: ${LIST_STATUSES.join(', ')}`, 400);
  }
  const searchFilter = buildContainsFilter(search);

  const where = {
    status: statusFilter,
    roles: role ? { has: role } : { hasSome: ['buyer', 'seller'] },
    ...(searchFilter
      ? { OR: [{ name: searchFilter }, { firmName: searchFilter }, { phone: searchFilter }] }
      : {}),
  };

  const [data, total] = await Promise.all([
    prisma.appUser.findMany({
      where,
      select: {
        id: true,
        name: true,
        firmName: true,
        phone: true,
        roles: true,
        city: true,
        status: true,
        defaultPaymentTerms: true,
      },
      // id as the last key keeps the order stable between pages
      orderBy: [{ firmName: { sort: 'asc', nulls: 'last' } }, { name: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      skip,
      take,
    }),
    prisma.appUser.count({ where }),
  ]);

  return { data, total };
}

module.exports = { getOwnProfile, updateOwnProfile, listUsers };
