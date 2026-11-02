const { AppError } = require('../lib/errors');
const { validateUuid } = require('../lib/validators');

const URL_REGEX = /^https?:\/\/\S+$/i;
const VALID_SIDES = ['SELL', 'BUY'];

function optionalString(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AppError(`${fieldName} must be a string`, 400);
  }
  return value.trim() || null;
}

function requirePositiveInt(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

function optionalPositiveInt(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }
  return requirePositiveInt(value, fieldName);
}

// For fields where 0 is a real value (e.g. paymentTerms: 0 = immediate payment).
// Blank inputs (undefined / null / '' / whitespace — an empty Excel or form cell)
// mean "not provided" => null; they must NOT coerce to 0 via Number('').
function optionalNonNegativeInt(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new AppError(`${fieldName} must be a non-negative integer`, 400);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError(`${fieldName} must be a non-negative integer`, 400);
  }
  return parsed;
}

// CREATE-only: price is legitimately absent ("shell" listing / "open to offers").
function optionalPositiveDecimal(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive number`, 400);
  }
  return parsed;
}

// A price key present in a patch body must be a real number >= 0. `0` is the one
// explicit way to say "clear the price": callers map it to price=null + status
// `na` (see listing.service.js). null/blank/non-numeric values are still rejected
// rather than silently treated as "clear the price" — Number(null) and Number('')
// are 0, so they're ruled out before parsing.
function requireNonNegativeDecimal(value, fieldName) {
  const isBlank = value === null || (typeof value === 'string' && value.trim() === '');
  const parsed = isBlank || typeof value === 'boolean' ? NaN : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AppError(`${fieldName} must be a number >= 0 (0 clears the price)`, 400);
  }
  return parsed;
}

// Excel cells: a blank cell is "no price given" (null — keep the current price on
// update, no price on create); a literal 0 is the explicit clear (returned as 0).
function optionalNonNegativeDecimal(value, fieldName) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  return requireNonNegativeDecimal(value, fieldName);
}

function optionalUrlArray(value, fieldName) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AppError(`${fieldName} must be an array of URLs`, 400);
  }
  return value.map((url) => {
    if (typeof url !== 'string' || !URL_REGEX.test(url)) {
      throw new AppError(`${fieldName} must contain valid http(s) URLs`, 400);
    }
    return url;
  });
}

// Quality is a per-category admin-managed table, so the client sends its id (not a
// grade name). Required on both sides; whether it belongs to categoryId is checked
// in listing.service.js (fetchQuality).
function validateListingIdentity(body) {
  return {
    categoryId: validateUuid(body.categoryId, 'categoryId'),
    commodityId: validateUuid(body.commodityId, 'commodityId'),
    qualityId: validateUuid(body.qualityId, 'qualityId'),
  };
}

// A buy requirement never carries a price (and so never expires) — the price is
// agreed in negotiation. Sending one is a client bug, so reject loudly instead of
// silently dropping it. `null` is accepted: it says the same thing as omitting it.
function rejectBuyPrice(body) {
  if (body.price !== undefined && body.price !== null) {
    throw new AppError('price is not allowed on a buy requirement', 400);
  }
}

// side = BUY (create): deliberately minimal — only 3 real client inputs.
// Everything else on the row is server-derived (see listing.service.js).
function validateBuyRequirementInput(body) {
  rejectBuyPrice(body);
  return {
    ...validateListingIdentity(body),
    quantityBags: requirePositiveInt(body.quantityBags, 'quantityBags'),
  };
}

// side = SELL (create): the full form. itemName is NOT a client input — it's
// derived server-side from the resolved commodity's name (see listing.service.js),
// same as BUY, since commodityId already identifies the specific trademark/product.
function validateSellListingInput(body) {
  return {
    ...validateListingIdentity(body),
    quantityBags: requirePositiveInt(body.quantityBags, 'quantityBags'),
    weightKg: optionalPositiveInt(body.weightKg, 'weightKg'),
    price: optionalPositiveDecimal(body.price, 'price'),
    photoUrls: optionalUrlArray(body.photoUrls, 'photoUrls'),
    videoUrls: optionalUrlArray(body.videoUrls, 'videoUrls'),
    moisture: optionalString(body.moisture, 'moisture'),
    color: optionalString(body.color, 'color'),
    size: optionalString(body.size, 'size'),
    paymentTerms: optionalNonNegativeInt(body.paymentTerms, 'paymentTerms'),
    notes: optionalString(body.notes, 'notes'),
  };
}

// Dispatcher: POST /listings validates by body.side.
function validateListingCreateInput(body) {
  if (!VALID_SIDES.includes(body.side)) {
    throw new AppError(`side must be one of: ${VALID_SIDES.join(', ')}`, 400);
  }
  return body.side === 'BUY'
    ? { side: 'BUY', ...validateBuyRequirementInput(body) }
    : { side: 'SELL', ...validateSellListingInput(body) };
}

// PATCH: same per-field rules, but every field is optional and `side` is
// immutable — the existing row's side is passed in, never read from the body.
function validateBuyRequirementPatch(body) {
  rejectBuyPrice(body);
  const patch = {};
  if (body.categoryId !== undefined) {
    patch.categoryId = validateUuid(body.categoryId, 'categoryId');
  }
  if (body.commodityId !== undefined) {
    patch.commodityId = validateUuid(body.commodityId, 'commodityId');
  }
  if (body.qualityId !== undefined) {
    patch.qualityId = validateUuid(body.qualityId, 'qualityId');
  }
  if (body.quantityBags !== undefined) {
    patch.quantityBags = requirePositiveInt(body.quantityBags, 'quantityBags');
  }
  return patch;
}

function validateSellListingPatch(body) {
  const patch = {};
  if (body.categoryId !== undefined) {
    patch.categoryId = validateUuid(body.categoryId, 'categoryId');
  }
  if (body.commodityId !== undefined) {
    patch.commodityId = validateUuid(body.commodityId, 'commodityId');
  }
  if (body.qualityId !== undefined) {
    patch.qualityId = validateUuid(body.qualityId, 'qualityId');
  }
  if (body.quantityBags !== undefined) {
    patch.quantityBags = requirePositiveInt(body.quantityBags, 'quantityBags');
  }
  if (body.weightKg !== undefined) {
    patch.weightKg = optionalPositiveInt(body.weightKg, 'weightKg');
  }
  if (body.price !== undefined) {
    patch.price = requireNonNegativeDecimal(body.price, 'price');
  }
  if (body.photoUrls !== undefined) {
    patch.photoUrls = optionalUrlArray(body.photoUrls, 'photoUrls');
  }
  if (body.videoUrls !== undefined) {
    patch.videoUrls = optionalUrlArray(body.videoUrls, 'videoUrls');
  }
  if (body.moisture !== undefined) {
    patch.moisture = optionalString(body.moisture, 'moisture');
  }
  if (body.color !== undefined) {
    patch.color = optionalString(body.color, 'color');
  }
  if (body.size !== undefined) {
    patch.size = optionalString(body.size, 'size');
  }
  if (body.paymentTerms !== undefined) {
    // null (or blank) => "use my profile default" — resolved in listing.service.js.
    patch.paymentTerms = optionalNonNegativeInt(body.paymentTerms, 'paymentTerms');
  }
  if (body.notes !== undefined) {
    patch.notes = optionalString(body.notes, 'notes');
  }
  return patch;
}

function validateListingUpdateInput(side, body) {
  if (body.side !== undefined && body.side !== side) {
    throw new AppError('side is immutable', 400);
  }
  return side === 'BUY' ? validateBuyRequirementPatch(body) : validateSellListingPatch(body);
}

module.exports = {
  validateBuyRequirementInput,
  validateSellListingInput,
  validateListingCreateInput,
  validateListingUpdateInput,
  // Exported for reuse by listing-bulk.service.js — same per-field rules,
  // applied there row-by-row against parsed Excel cells (see that file).
  optionalString,
  requirePositiveInt,
  optionalPositiveInt,
  optionalNonNegativeInt,
  optionalPositiveDecimal,
  optionalNonNegativeDecimal,
  // Exported for reuse by listing.service.js's bulk "set-many" mode — each
  // {listingId, price} entry needs the same price rule (0 clears) as a single PATCH.
  requireNonNegativeDecimal,
};
