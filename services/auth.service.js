const ms = require('ms');
const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const otpService = require('./otp.service');
const brokerService = require('./broker.service');
const { validatePhone } = require('../lib/validators');
const { signAccessToken, generateRefreshToken, hashToken } = require('../lib/tokens');

const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '30d';
const OTP_REGEX = /^\d{4,6}$/;

function validateOtp(otp) {
  if (typeof otp !== 'string' || !OTP_REGEX.test(otp)) {
    throw new AppError('otp must be a 4 digit code', 400);
  }
}

function validateRefreshToken(refreshToken) {
  if (typeof refreshToken !== 'string' || !refreshToken.trim()) {
    throw new AppError('refreshToken is required', 400);
  }
}

async function checkLoginEligibility(phone) {
  const user = await prisma.appUser.findUnique({ where: { phone } });

  if (user) {
    if (user.status !== 'active') {
      throw new AppError('Account is not active', 403);
    }
    return { eligible: true, existingUser: user };
  }

  const invite = await prisma.invite.findFirst({
    where: { phone, status: 'pending' },
  });

  if (invite) {
    return { eligible: true, existingUser: null, invite };
  }

  throw new AppError('This number is not invited', 403);
}

async function issueTokenPair(user) {
  const accessToken = signAccessToken(user);
  const refreshTokenPlain = generateRefreshToken();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshTokenPlain),
      expiresAt: new Date(Date.now() + ms(REFRESH_TOKEN_EXPIRES_IN)),
    },
  });

  return { accessToken, refreshToken: refreshTokenPlain };
}

async function login(phone) {
  const normalizedPhone = validatePhone(phone);
  await checkLoginEligibility(normalizedPhone);
  otpService.sendOtp(normalizedPhone);
}

async function verifyOtp({ phone, otp }) {
  const normalizedPhone = validatePhone(phone);
  validateOtp(otp);

  if (!otpService.verifyOtpCode(normalizedPhone, otp)) {
    throw new AppError('Invalid OTP', 401);
  }

  const eligibility = await checkLoginEligibility(normalizedPhone);
  let user = eligibility.existingUser;

  if (!user) {
    user = await prisma.$transaction(async (tx) => {
      const invite = await tx.invite.findFirst({
        where: { phone: normalizedPhone, status: 'pending' },
      });
      if (!invite) {
        throw new AppError('This number is not invited', 403);
      }

      const createdUser = await tx.appUser.create({
        data: {
          phone: normalizedPhone,
          roles: [invite.roleHint],
          invitedById: invite.invitedById,
          status: 'active',
        },
      });

      await tx.invite.update({
        where: { id: invite.id },
        data: { status: 'accepted' },
      });

      // A broker's invite also ties their new account to their broker row, so the
      // user id in the token can be traced to trade.broker_id ("my trades").
      if (invite.roleHint === 'broker') {
        await brokerService.linkBrokerToUser(tx, createdUser);
      }

      return createdUser;
    });
  }

  const tokens = await issueTokenPair(user);
  return { ...tokens, user };
}

async function refreshAccessToken({ refreshToken }) {
  validateRefreshToken(refreshToken);
  const tokenHash = hashToken(refreshToken);

  const stored = await prisma.refreshToken.findFirst({
    where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
  });

  if (!stored) {
    throw new AppError('Invalid refresh token', 401);
  }

  if (stored.user.status !== 'active') {
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    throw new AppError('Account is not active', 403);
  }

  return { accessToken: signAccessToken(stored.user) };
}

async function logout({ refreshToken }) {
  validateRefreshToken(refreshToken);
  const tokenHash = hashToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

module.exports = {
  checkLoginEligibility,
  login,
  verifyOtp,
  refreshAccessToken,
  logout,
};
