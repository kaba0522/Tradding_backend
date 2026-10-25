const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
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

module.exports = { getOwnProfile, updateOwnProfile };
