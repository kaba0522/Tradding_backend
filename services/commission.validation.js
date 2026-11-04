const { AppError } = require('../lib/errors');

const MAX_COMMISSION_RATE = 99999999.99; // Decimal(10, 2)
const MAX_PERCENT = 100;
// per_bag is the "flat" rate: ₹ per bag. percent is a % of the whole trade value.
const COMMISSION_TYPES = ['percent', 'per_bag'];

function normalizeCommissionType(value) {
  if (!COMMISSION_TYPES.includes(value)) {
    throw new AppError(`commissionType is required and must be one of: ${COMMISSION_TYPES.join(', ')}`, 400);
  }
  return value;
}

function normalizeCommissionRate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new AppError('commissionRate is required and must be a non-negative number', 400);
  }
  if (value > MAX_COMMISSION_RATE) {
    throw new AppError(`commissionRate must not exceed ${MAX_COMMISSION_RATE}`, 400);
  }
  // Tolerance, not ===: 1.1 * 100 is 110.00000000000001 in floating point.
  if (Math.abs(Math.round(value * 100) - value * 100) > 1e-6) {
    throw new AppError('commissionRate must have at most 2 decimal places', 400);
  }
  return value;
}

// Same rule as the ck_category_commission / ck_trade_commission CHECKs in the DB.
function buildCommissionValue(body) {
  const source = body || {};
  const commissionType = normalizeCommissionType(source.commissionType);
  const commissionRate = normalizeCommissionRate(source.commissionRate);
  if (commissionType === 'percent' && commissionRate > MAX_PERCENT) {
    throw new AppError(`commissionRate must not exceed ${MAX_PERCENT} for a percent commission`, 400);
  }
  return { commissionType, commissionRate };
}

module.exports = { COMMISSION_TYPES, buildCommissionValue };
