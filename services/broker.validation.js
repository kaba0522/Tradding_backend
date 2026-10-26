const { AppError } = require('../lib/errors');
const { validatePhone } = require('../lib/validators');

const MAX_NAME_LENGTH = 100;
const MAX_COMMISSION_RATE = 99999999.99; // Decimal(10, 2)
const MAX_PERCENT = 100;
const COMMISSION_TYPES = ['percent', 'per_bag', 'flat'];

// Fields an admin can set on a broker. Anything else in the body (id, active,
// createdById, timestamps...) is ignored — `active` only changes through the
// deactivate/reactivate endpoints so each one gets its own audit action.
const EDITABLE_FIELDS = ['name', 'phone', 'commissionType', 'commissionRate'];

function normalizeName(value) {
  if (typeof value !== 'string') {
    throw new AppError('name is required and must be a string', 400);
  }
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    throw new AppError('name is required', 400);
  }
  if (cleaned.length > MAX_NAME_LENGTH) {
    throw new AppError(`name must be at most ${MAX_NAME_LENGTH} characters`, 400);
  }
  return cleaned;
}

function normalizeCommissionType(value) {
  if (value === null) return null;
  if (!COMMISSION_TYPES.includes(value)) {
    throw new AppError(`commissionType must be one of: ${COMMISSION_TYPES.join(', ')}`, 400);
  }
  return value;
}

function normalizeCommissionRate(value) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new AppError('commissionRate must be a non-negative number', 400);
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

// Type and rate only make sense together: both set or both null. Checked on the
// final (merged) state so a PATCH can change just the rate of an existing type.
// Same rule as the ck_broker_commission CHECK constraint in the DB.
function assertCommissionPair(commissionType, commissionRate) {
  if ((commissionType === null) !== (commissionRate === null)) {
    throw new AppError('commissionType and commissionRate must be provided together', 400);
  }
  if (commissionType === 'percent' && commissionRate > MAX_PERCENT) {
    throw new AppError(`commissionRate must not exceed ${MAX_PERCENT} for a percent commission`, 400);
  }
}

function buildBrokerCreateData(body) {
  const commissionType =
    body.commissionType === undefined ? null : normalizeCommissionType(body.commissionType);
  const commissionRate =
    body.commissionRate === undefined ? null : normalizeCommissionRate(body.commissionRate);
  assertCommissionPair(commissionType, commissionRate);

  return {
    name: normalizeName(body.name),
    phone: validatePhone(body.phone),
    commissionType,
    commissionRate,
  };
}

// Picks only the editable fields present in the body. `existing` supplies the
// current commission so a partial commission edit is validated as a whole.
function buildBrokerUpdateData(body, existing) {
  const data = {};

  if (body.name !== undefined) data.name = normalizeName(body.name);
  if (body.phone !== undefined) data.phone = validatePhone(body.phone);
  if (body.commissionType !== undefined) data.commissionType = normalizeCommissionType(body.commissionType);
  if (body.commissionRate !== undefined) data.commissionRate = normalizeCommissionRate(body.commissionRate);

  if (Object.keys(data).length === 0) {
    throw new AppError(`At least one of: ${EDITABLE_FIELDS.join(', ')} must be provided`, 400);
  }

  if (data.commissionType !== undefined || data.commissionRate !== undefined) {
    const finalType = data.commissionType !== undefined ? data.commissionType : existing.commissionType;
    const finalRate =
      data.commissionRate !== undefined
        ? data.commissionRate
        : existing.commissionRate === null
          ? null
          : Number(existing.commissionRate);
    assertCommissionPair(finalType, finalRate);
  }

  return data;
}

// ?active=true|false on the list endpoint; absent means both.
function parseActiveFilter(value) {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new AppError('active must be true or false', 400);
}

module.exports = {
  COMMISSION_TYPES,
  EDITABLE_FIELDS,
  buildBrokerCreateData,
  buildBrokerUpdateData,
  parseActiveFilter,
};
