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

  const user = await prisma.appUser.update({
    where: { id: userId },
    data,
  });

  return user;
}

module.exports = { getOwnProfile, updateOwnProfile };
