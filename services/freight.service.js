const ExcelJS = require('exceljs');
const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { validateUuid } = require('../lib/validators');
const { buildContainsFilter } = require('../lib/filters');
const { getSettingValue } = require('./settings.service');

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DEFAULT_UNIT = 'per_quintal';
const MAX_NAME_LENGTH = 100;
const MAX_UNIT_LENGTH = 50;
const MAX_CAPACITY_LENGTH = 100;
const MAX_UPLOAD_ROWS = 500;
const MAX_PRICE = 9999999999.99; // Decimal(12, 2)

// Template / upload columns. `aliases` are matched against the header cell after
// lower-casing and stripping everything that isn't a letter or digit, so
// "Price Low", "price_low" and "PRICE-LOW" all resolve to the same column.
const COLUMNS = [
  { header: 'Origin', key: 'origin', width: 22, aliases: ['origin', 'originname', 'from'] },
  { header: 'Destination', key: 'destination', width: 22, aliases: ['destination', 'destinationname', 'to'] },
  { header: 'Price Low', key: 'priceLow', width: 14, aliases: ['pricelow', 'low', 'minprice'] },
  { header: 'Price High', key: 'priceHigh', width: 14, aliases: ['pricehigh', 'high', 'maxprice'] },
  { header: 'Unit', key: 'unit', width: 16, aliases: ['unit'] },
  { header: 'Truck Capacity', key: 'truckCapacity', width: 18, aliases: ['truckcapacity', 'capacity'] },
];

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

// Same maths as listing.service.js#computeNextExpiryCutoff, but driven by its own
// setting (freight_expiry_time) so freight can expire at a different time of day
// than listings. Deliberately NOT shared with the listing code so changing one
// can never affect the other.
async function computeFreightExpiryCutoff(now = new Date()) {
  const { time } = await getSettingValue('freight_expiry_time', { time: '02:00' });
  const [hours, minutes] = time.split(':').map(Number);

  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const cutoffUtcMs =
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), hours, minutes) -
    IST_OFFSET_MS;

  return cutoffUtcMs <= now.getTime()
    ? new Date(cutoffUtcMs + 24 * 60 * 60 * 1000)
    : new Date(cutoffUtcMs);
}

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------

function normalizeName(value, fieldName) {
  if (typeof value !== 'string') {
    throw new AppError(`${fieldName} is required and must be a string`, 400);
  }
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    throw new AppError(`${fieldName} is required`, 400);
  }
  if (cleaned.length > MAX_NAME_LENGTH) {
    throw new AppError(`${fieldName} must be at most ${MAX_NAME_LENGTH} characters`, 400);
  }
  return cleaned;
}

function normalizeUnit(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_UNIT;
  }
  if (typeof value !== 'string') {
    throw new AppError('unit must be a string', 400);
  }
  const cleaned = value.trim().toLowerCase().replace(/\s+/g, '_');
  if (!cleaned) {
    return DEFAULT_UNIT;
  }
  if (cleaned.length > MAX_UNIT_LENGTH) {
    throw new AppError(`unit must be at most ${MAX_UNIT_LENGTH} characters`, 400);
  }
  return cleaned;
}

function normalizeTruckCapacity(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const cleaned = String(value).trim().replace(/\s+/g, ' ');
  if (!cleaned) {
    return null;
  }
  if (cleaned.length > MAX_CAPACITY_LENGTH) {
    throw new AppError(`truckCapacity must be at most ${MAX_CAPACITY_LENGTH} characters`, 400);
  }
  return cleaned;
}

// Returns null for "not provided", a positive number otherwise. Excel sheets often
// carry prices as text like "160/-" or "₹1,60.50", so strings are cleaned first.
function parsePriceValue(value, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }

  let parsed;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string') {
    const cleaned = value.replace(/₹|rs\.?|\/-|,|\s/gi, '');
    if (!cleaned) {
      return null;
    }
    if (!/^\d+(\.\d+)?$/.test(cleaned)) {
      throw new AppError(`${fieldName} must be a positive number`, 400);
    }
    parsed = Number(cleaned);
  } else {
    throw new AppError(`${fieldName} must be a positive number`, 400);
  }

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive number`, 400);
  }
  const rounded = Math.round(parsed * 100) / 100;
  if (rounded > MAX_PRICE) {
    throw new AppError(`${fieldName} is too large`, 400);
  }
  return rounded;
}

// The price rule: only one of low/high given -> both take that value; both given ->
// stored as-is (low must not exceed high); neither -> error.
function resolvePriceRange(lowRaw, highRaw) {
  let low = parsePriceValue(lowRaw, 'priceLow');
  let high = parsePriceValue(highRaw, 'priceHigh');

  if (low === null && high === null) {
    throw new AppError('priceLow or priceHigh is required', 400);
  }
  if (low === null) {
    low = high;
  } else if (high === null) {
    high = low;
  }
  if (low > high) {
    throw new AppError('priceLow must not be greater than priceHigh', 400);
  }
  return { priceLow: low, priceHigh: high };
}

function pairKey(originName, destinationName) {
  return `${originName.toLowerCase()}|${destinationName.toLowerCase()}`;
}

function toNumberOrNull(decimal) {
  if (decimal === null || decimal === undefined) {
    return null;
  }
  return typeof decimal.toNumber === 'function' ? decimal.toNumber() : Number(decimal);
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function isEffectivelyExpired(route, now) {
  return (
    route.status === 'price_expired' ||
    (route.priceValidUntil !== null && route.priceValidUntil <= now)
  );
}

// The hourly job can lag the real expiry moment by up to an hour, so expiry is also
// evaluated at read time. Non-admins never receive the price of an expired route
// (the server decides, not the client). Admins keep seeing the last price so they
// know what they are about to overwrite.
function serializeRoute(route, { isAdmin, now }) {
  const expired = isEffectivelyExpired(route, now);
  const hidePrice = expired && !isAdmin;
  return {
    id: route.id,
    originName: route.originName,
    destinationName: route.destinationName,
    priceLow: hidePrice ? null : toNumberOrNull(route.priceLow),
    priceHigh: hidePrice ? null : toNumberOrNull(route.priceHigh),
    unit: route.unit,
    truckCapacity: route.truckCapacity,
    priceValidUntil: route.priceValidUntil,
    status: expired ? 'price_expired' : route.status,
    updatedAt: route.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

// Flat, paginated list of routes (one row per route, like the freight table in the app),
// sorted by origin then destination. `origin` / `destination` are case-insensitive
// "contains" searches, so searching an origin returns all of its destinations, page by page.
// The page size is bounded by `take` no matter how many routes one origin has.
async function listRoutes({ origin, destination, isAdmin, skip = 0, take }) {
  const originFilter = buildContainsFilter(origin);
  const destinationFilter = buildContainsFilter(destination);
  const where = {};
  if (originFilter) where.originName = originFilter;
  if (destinationFilter) where.destinationName = destinationFilter;

  const [routes, total] = await Promise.all([
    prisma.freightRoute.findMany({
      where,
      // id as the last key keeps the order stable between pages
      orderBy: [{ originName: 'asc' }, { destinationName: 'asc' }, { id: 'asc' }],
      skip,
      take,
    }),
    prisma.freightRoute.count({ where }),
  ]);

  const now = new Date();
  return { data: routes.map((route) => serializeRoute(route, { isAdmin, now })), total };
}

// ---------------------------------------------------------------------------
// Single-route write (admin)
// ---------------------------------------------------------------------------

async function createRoute(body, actorUserId) {
  const data = {
    originName: normalizeName(body.originName, 'originName'),
    destinationName: normalizeName(body.destinationName, 'destinationName'),
    ...resolvePriceRange(body.priceLow, body.priceHigh),
    unit: normalizeUnit(body.unit),
    truckCapacity: normalizeTruckCapacity(body.truckCapacity),
  };

  let route;
  try {
    route = await prisma.freightRoute.create({
      data: {
        ...data,
        priceValidUntil: await computeFreightExpiryCutoff(),
        status: 'active',
        updatedById: actorUserId,
      },
    });
  } catch (err) {
    if (err.code === 'P2002' || /uq_freight_route_origin_destination/.test(err.message || '')) {
      throw new AppError('A route with this origin and destination already exists', 409);
    }
    throw err;
  }

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'FREIGHT_ROUTE_CREATED',
      entity: 'FreightRoute',
      entityId: route.id,
      before: null,
      after: route,
    },
  });

  return serializeRoute(route, { isAdmin: true, now: new Date() });
}

async function updateRoute(id, body, actorUserId) {
  validateUuid(id);
  const existing = await prisma.freightRoute.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Freight route not found', 404);
  }

  const data = {};
  if (body.originName !== undefined) {
    data.originName = normalizeName(body.originName, 'originName');
  }
  if (body.destinationName !== undefined) {
    data.destinationName = normalizeName(body.destinationName, 'destinationName');
  }
  if (body.unit !== undefined) {
    data.unit = normalizeUnit(body.unit);
  }
  if (body.truckCapacity !== undefined) {
    data.truckCapacity = normalizeTruckCapacity(body.truckCapacity);
  }

  // A price edit is a fresh daily price: it re-activates the route and restarts its
  // expiry clock. Non-price edits (e.g. truck capacity) leave status/expiry alone, so
  // fixing a typo on an expired route doesn't silently bring a stale price back to life.
  // The price rule applies to what is sent in THIS request (send both for a range).
  if (body.priceLow !== undefined || body.priceHigh !== undefined) {
    Object.assign(data, resolvePriceRange(body.priceLow, body.priceHigh));
    data.status = 'active';
    data.priceValidUntil = await computeFreightExpiryCutoff();
  }

  if (Object.keys(data).length === 0) {
    throw new AppError('No updatable fields provided', 400);
  }

  let route;
  try {
    route = await prisma.freightRoute.update({
      where: { id },
      data: { ...data, updatedById: actorUserId, updatedAt: new Date() },
    });
  } catch (err) {
    if (err.code === 'P2002' || /uq_freight_route_origin_destination/.test(err.message || '')) {
      throw new AppError('A route with this origin and destination already exists', 409);
    }
    throw err;
  }

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'FREIGHT_ROUTE_UPDATED',
      entity: 'FreightRoute',
      entityId: id,
      before: existing,
      after: route,
    },
  });

  return serializeRoute(route, { isAdmin: true, now: new Date() });
}

async function deleteRoute(id, actorUserId) {
  validateUuid(id);
  const existing = await prisma.freightRoute.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Freight route not found', 404);
  }

  await prisma.freightRoute.delete({ where: { id } });

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'FREIGHT_ROUTE_DELETED',
      entity: 'FreightRoute',
      entityId: id,
      before: existing,
      after: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Excel: template, preview, commit
// ---------------------------------------------------------------------------

function generateTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Freight');
  sheet.columns = COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow({
    origin: 'Ludhiana',
    destination: 'Amritsar',
    priceLow: 160,
    priceHigh: 165,
    unit: DEFAULT_UNIT,
    truckCapacity: '30-35 MT',
  });
  return workbook;
}

// ExcelJS hands back different shapes depending on the cell (formula result, rich
// text, hyperlink, date...). Flatten to a plain string/number so validation is uniform.
function cellToPrimitive(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object') {
    if (value instanceof Date) return null;
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if ('result' in value) return cellToPrimitive(value.result);
    if ('text' in value) return value.text;
    return null;
  }
  return value;
}

function asText(value) {
  return value === null || value === undefined ? '' : String(value);
}

function normalizeHeader(value) {
  return String(cellToPrimitive(value) ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function readWorkbookRows(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw new AppError('Could not read the file — please upload a valid .xlsx', 400);
  }

  const sheet =
    workbook.worksheets.find((ws) => ws.state !== 'hidden' && ws.state !== 'veryHidden') ||
    workbook.worksheets[0];
  if (!sheet) {
    throw new AppError('Uploaded file has no worksheet', 400);
  }

  // Header row (row 1) -> column index per field.
  const headerCells = sheet.getRow(1).values;
  const columnIndex = {};
  for (let i = 1; i < headerCells.length; i += 1) {
    const normalized = normalizeHeader(headerCells[i]);
    const column = COLUMNS.find((c) => c.aliases.includes(normalized));
    if (column && columnIndex[column.key] === undefined) {
      columnIndex[column.key] = i;
    }
  }

  if (columnIndex.origin === undefined || columnIndex.destination === undefined) {
    throw new AppError('Header row must contain "Origin" and "Destination" columns', 400);
  }
  if (columnIndex.priceLow === undefined && columnIndex.priceHigh === undefined) {
    throw new AppError('Header row must contain a "Price Low" and/or "Price High" column', 400);
  }

  const rawRows = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const cells = sheet.getRow(rowNumber).values;
    const raw = {};
    for (const column of COLUMNS) {
      const idx = columnIndex[column.key];
      raw[column.key] = idx === undefined ? null : cellToPrimitive(cells[idx]);
    }
    const isBlank = Object.values(raw).every(
      (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
    );
    if (isBlank) {
      continue;
    }
    rawRows.push({ rowNumber, raw });
    if (rawRows.length > MAX_UPLOAD_ROWS) {
      throw new AppError(`File has too many rows (maximum ${MAX_UPLOAD_ROWS})`, 400);
    }
  }

  if (rawRows.length === 0) {
    throw new AppError('File has no data rows', 400);
  }
  return rawRows;
}

// Validates every row (collecting all errors, not stopping at the first), flags
// duplicate origin+destination pairs within the file, and works out whether each
// valid row would create a new route or update an existing one.
async function analyzeUpload(buffer) {
  const rawRows = await readWorkbookRows(buffer);

  const existingRoutes = await prisma.freightRoute.findMany();
  const existingByKey = new Map(existingRoutes.map((r) => [pairKey(r.originName, r.destinationName), r]));

  const seenInFile = new Map();
  const rows = rawRows.map(({ rowNumber, raw }) => {
    const errors = [];
    const collect = (fn) => {
      try {
        return fn();
      } catch (err) {
        errors.push(err.message);
        return undefined;
      }
    };

    const originName = collect(() => normalizeName(asText(raw.origin), 'origin'));
    const destinationName = collect(() => normalizeName(asText(raw.destination), 'destination'));
    const range = collect(() => resolvePriceRange(raw.priceLow, raw.priceHigh));
    const unit = collect(() => normalizeUnit(asText(raw.unit)));
    const truckCapacity = collect(() => normalizeTruckCapacity(raw.truckCapacity));

    let action = null;
    let existing = null;
    if (originName && destinationName) {
      const key = pairKey(originName, destinationName);
      if (seenInFile.has(key)) {
        errors.push(`duplicate of row ${seenInFile.get(key)} (same origin and destination)`);
      } else {
        seenInFile.set(key, rowNumber);
      }
      existing = existingByKey.get(key) || null;
      action = existing ? 'update' : 'create';
    }

    const valid = errors.length === 0;
    return {
      rowNumber,
      valid,
      errors,
      action: valid ? action : null,
      data: valid
        ? { originName, destinationName, ...range, unit, truckCapacity }
        : null,
      previous:
        valid && existing
          ? { priceLow: toNumberOrNull(existing.priceLow), priceHigh: toNumberOrNull(existing.priceHigh) }
          : null,
      existingId: valid && existing ? existing.id : null,
    };
  });

  return rows;
}

function summarize(rows) {
  const invalid = rows.filter((r) => !r.valid).length;
  return {
    totalRows: rows.length,
    toCreate: rows.filter((r) => r.action === 'create').length,
    toUpdate: rows.filter((r) => r.action === 'update').length,
    invalidRows: invalid,
    canCommit: invalid === 0,
  };
}

// Dry run: parses and validates, reports what a commit would do, saves nothing.
async function previewUpload(buffer) {
  const rows = await analyzeUpload(buffer);
  return {
    summary: summarize(rows),
    rows: rows.map(({ existingId, ...rest }) => rest),
  };
}

// All-or-nothing: if any row is invalid nothing is written. Valid files are applied
// in a single transaction (create new pairs, update existing ones), each touched
// route gets a fresh expiry and goes back to `active`, and one audit entry records it.
async function commitUpload(buffer, actorUserId) {
  const rows = await analyzeUpload(buffer);
  const summary = summarize(rows);

  if (!summary.canCommit) {
    const err = new AppError(
      `${summary.invalidRows} row(s) have errors — nothing was saved. Fix them and upload again.`,
      400,
      'VALIDATION_FAILED'
    );
    err.details = rows
      .filter((r) => !r.valid)
      .map((r) => ({ rowNumber: r.rowNumber, errors: r.errors }));
    throw err;
  }

  const priceValidUntil = await computeFreightExpiryCutoff();
  const now = new Date();

  try {
    await prisma.$transaction(
      rows.map((row) => {
        if (row.action === 'update') {
          // Origin/destination casing of the existing row is kept (only the price,
          // unit and capacity are refreshed), so the display name doesn't flip around.
          return prisma.freightRoute.update({
            where: { id: row.existingId },
            data: {
              priceLow: row.data.priceLow,
              priceHigh: row.data.priceHigh,
              unit: row.data.unit,
              truckCapacity: row.data.truckCapacity,
              priceValidUntil,
              status: 'active',
              updatedById: actorUserId,
              updatedAt: now,
            },
          });
        }
        return prisma.freightRoute.create({
          data: {
            ...row.data,
            priceValidUntil,
            status: 'active',
            updatedById: actorUserId,
          },
        });
      })
    );
  } catch (err) {
    if (err.code === 'P2002' || /uq_freight_route_origin_destination/.test(err.message || '')) {
      // Someone created the same pair between our read and write; nothing was saved.
      throw new AppError('Routes changed while uploading — please upload again', 409);
    }
    throw err;
  }

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: 'FREIGHT_BULK_UPLOAD',
      entity: 'FreightRoute',
      entityId: 'bulk',
      before: null,
      after: {
        created: summary.toCreate,
        updated: summary.toUpdate,
        rows: rows.map((r) => ({
          action: r.action,
          originName: r.data.originName,
          destinationName: r.data.destinationName,
          priceLow: r.data.priceLow,
          priceHigh: r.data.priceHigh,
          previous: r.previous,
        })),
      },
    },
  });

  return { created: summary.toCreate, updated: summary.toUpdate, totalRows: summary.totalRows };
}

module.exports = {
  computeFreightExpiryCutoff,
  listRoutes,
  createRoute,
  updateRoute,
  deleteRoute,
  generateTemplateWorkbook,
  previewUpload,
  commitUpload,
};
