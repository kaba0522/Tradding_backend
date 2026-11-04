const { AppError } = require('../lib/errors');
const { validatePhone } = require('../lib/validators');

const MAX_NAME_LENGTH = 100;

// Fields an admin can set on a broker. Anything else in the body (id, active,
// userId, timestamps...) is ignored — `active` only changes through the
// deactivate/reactivate endpoints so each one gets its own audit action.
// Commission is not here: it is set per commodity category (services/commission.service.js).
const EDITABLE_FIELDS = ['name', 'phone'];

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

// Brokers used to carry their own commission. Fail loudly instead of silently
// ignoring it, so a client still sending it learns the rate now lives on the category.
function rejectBrokerCommission(body) {
  if (body.commissionType !== undefined || body.commissionRate !== undefined) {
    throw new AppError(
      'Commission is no longer set on a broker — set it per commodity category via /commissions',
      400
    );
  }
}

function buildBrokerCreateData(body) {
  rejectBrokerCommission(body);
  return {
    name: normalizeName(body.name),
    phone: validatePhone(body.phone),
  };
}

// Picks only the editable fields present in the body.
function buildBrokerUpdateData(body) {
  rejectBrokerCommission(body);
  const data = {};

  if (body.name !== undefined) data.name = normalizeName(body.name);
  if (body.phone !== undefined) data.phone = validatePhone(body.phone);

  if (Object.keys(data).length === 0) {
    throw new AppError(`At least one of: ${EDITABLE_FIELDS.join(', ')} must be provided`, 400);
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
  EDITABLE_FIELDS,
  buildBrokerCreateData,
  buildBrokerUpdateData,
  parseActiveFilter,
};
