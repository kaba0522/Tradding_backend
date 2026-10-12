const { AppError } = require('../lib/errors');

const MAX_TEXT_LENGTH = 255;
const MAX_NOTES_LENGTH = 2000;

// Fields an account can set on its own profile. Anything else in the request
// body (phone, roles, status, id, invitedById, tosAccepted*...) is silently
// ignored by the caller rather than erroring, so extra fields never break the
// request — see services/user.service.js.
const EDITABLE_FIELDS = ['name', 'firmName', 'city', 'firmNotes', 'defaultPaymentTerms', 'defaultWeightKg'];

function validateOptionalString(value, fieldName, maxLength) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new AppError(`${fieldName} must be a string`, 400);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw new AppError(`${fieldName} must be at most ${maxLength} characters`, 400);
  }
  return trimmed;
}

function validateOptionalPositiveInt(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new AppError(`${fieldName} must be a non-negative integer`, 400);
  }
  return value;
}

// Picks only the whitelisted, user-editable fields out of the request body and
// validates each one present. Returns a Prisma-ready `data` object.
function buildProfileUpdateData(body) {
  const data = {};

  const name = validateOptionalString(body.name, 'name', MAX_TEXT_LENGTH);
  if (name !== undefined) data.name = name;

  const firmName = validateOptionalString(body.firmName, 'firmName', MAX_TEXT_LENGTH);
  if (firmName !== undefined) data.firmName = firmName;

  const city = validateOptionalString(body.city, 'city', MAX_TEXT_LENGTH);
  if (city !== undefined) data.city = city;

  const firmNotes = validateOptionalString(body.firmNotes, 'firmNotes', MAX_NOTES_LENGTH);
  if (firmNotes !== undefined) data.firmNotes = firmNotes;

  const defaultPaymentTerms = validateOptionalPositiveInt(body.defaultPaymentTerms, 'defaultPaymentTerms');
  if (defaultPaymentTerms !== undefined) data.defaultPaymentTerms = defaultPaymentTerms;

  const defaultWeightKg = validateOptionalPositiveInt(body.defaultWeightKg, 'defaultWeightKg');
  if (defaultWeightKg !== undefined) data.defaultWeightKg = defaultWeightKg;

  if (Object.keys(data).length === 0) {
    throw new AppError(`At least one of: ${EDITABLE_FIELDS.join(', ')} must be provided`, 400);
  }

  return data;
}

module.exports = { EDITABLE_FIELDS, buildProfileUpdateData };
