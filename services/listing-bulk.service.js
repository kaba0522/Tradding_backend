const ExcelJS = require('exceljs');
const stringSimilarity = require('string-similarity');
const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { validateUuid } = require('../lib/validators');
const {
  createListing,
  fetchCategoryAndCommodity,
  computeNextExpiryCutoff,
  getOwnerDefaultPaymentTerms,
  resolvePaymentTerms,
} = require('./listing.service');
const {
  QUALITY_GRADES,
  optionalString,
  requirePositiveInt,
  optionalPositiveInt,
  optionalNonNegativeInt,
  optionalPositiveDecimal,
  optionalEnum,
} = require('./listing.validation');

const FUZZY_THRESHOLD = 0.6;
const TEMPLATE_DATA_ROWS = 500;
// Must match the partial unique index's WHERE clause in the
// convert_quality_to_enum migration (uq_listing_no_duplicate_sell).
const LIVE_STATUSES = ['active', 'na', 'price_expired'];

const COLUMNS = [
  { header: 'Category', key: 'category', width: 20 },
  { header: 'Commodity', key: 'commodity', width: 30 },
  { header: 'Quality', key: 'quality', width: 14 },
  { header: 'Quantity (Bags)', key: 'quantityBags', width: 16 },
  { header: 'Weight (Kg)', key: 'weightKg', width: 12 },
  { header: 'Price', key: 'price', width: 12 },
  { header: 'Payment Terms', key: 'paymentTerms', width: 22 },
  { header: 'Notes', key: 'notes', width: 30 },
  { header: 'Moisture', key: 'moisture', width: 12 },
  { header: 'Color', key: 'color', width: 12 },
  { header: 'Size', key: 'size', width: 12 },
];

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

// 3-layer match: exact (normalized) -> fuzzy suggestion (never auto-applied) -> unresolved.
function matchName(rawValue, candidates) {
  const raw = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!raw) {
    return { id: null, match: 'unresolved', suggestion: null };
  }
  const normalizedRaw = normalize(raw);

  const exact = candidates.find((c) => normalize(c.name) === normalizedRaw);
  if (exact) {
    return { id: exact.id, match: 'exact', suggestion: null };
  }

  if (candidates.length === 0) {
    return { id: null, match: 'unresolved', suggestion: null };
  }

  const candidateNames = candidates.map((c) => normalize(c.name));
  const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(normalizedRaw, candidateNames);
  if (bestMatch.rating >= FUZZY_THRESHOLD) {
    const candidate = candidates[bestMatchIndex];
    return {
      id: null,
      match: 'fuzzy',
      suggestion: { id: candidate.id, name: candidate.name, similarity: Number(bestMatch.rating.toFixed(2)) },
    };
  }

  return { id: null, match: 'unresolved', suggestion: null };
}

// Runs a field validator and collects a message into `errors` instead of throwing,
// so one bad cell doesn't stop the rest of the row from being checked.
function tryValidate(errors, fn) {
  try {
    return fn();
  } catch (err) {
    errors.push(err.message);
    return undefined;
  }
}

async function generateTemplateWorkbook() {
  const [categories, commodities] = await Promise.all([
    prisma.commodityCategory.findMany({ orderBy: { name: 'asc' } }),
    prisma.commodity.findMany({ orderBy: { name: 'asc' } }),
  ]);

  const workbook = new ExcelJS.Workbook();

  const listsSheet = workbook.addWorksheet('_lists');
  // veryHidden: unlike plain 'hidden', this can't be revealed via Excel's normal
  // Unhide dialog (only via VBA) — a stronger default than relying on 'hidden' alone.
  listsSheet.state = 'veryHidden';
  categories.forEach((c, i) => {
    listsSheet.getCell(i + 1, 1).value = c.name;
  });
  commodities.forEach((c, i) => {
    listsSheet.getCell(i + 1, 2).value = c.name;
  });
  // Belt-and-suspenders: if some viewer ignores the hidden state and shows this
  // sheet anyway, sheet protection still stops the dropdown source values from
  // being edited (all cells are locked by default; protecting the sheet enforces it).
  await listsSheet.protect('', {
    selectLockedCells: false,
    selectUnlockedCells: false,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    insertHyperlinks: false,
    deleteColumns: false,
    deleteRows: false,
    sort: false,
    autoFilter: false,
    pivotTables: false,
  });

  const sheet = workbook.addWorksheet('Listings');
  sheet.columns = COLUMNS;

  const categoryRange = `_lists!$A$1:$A$${Math.max(categories.length, 1)}`;
  const commodityRange = `_lists!$B$1:$B$${Math.max(commodities.length, 1)}`;
  const qualityInline = `"${QUALITY_GRADES.join(',')}"`;

  for (let row = 2; row <= TEMPLATE_DATA_ROWS + 1; row += 1) {
    sheet.getCell(`A${row}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [categoryRange],
      showErrorMessage: true,
      errorTitle: 'Invalid category',
      error: 'Please pick a category from the dropdown list.',
    };
    sheet.getCell(`B${row}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [commodityRange],
      showErrorMessage: true,
      errorTitle: 'Invalid commodity',
      error: 'Please pick a commodity from the dropdown list.',
    };
    sheet.getCell(`C${row}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [qualityInline],
      showErrorMessage: true,
      errorTitle: 'Invalid quality',
      error: `Quality must be one of: ${QUALITY_GRADES.join(', ')}`,
    };
  }

  return workbook;
}

async function parseUploadedWorkbook(buffer, userId) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  // NOT worksheets[0] — the template's hidden `_lists` sheet is created first, so
  // index 0 would pick it up instead of the actual data sheet the seller filled in.
  // Pick the first non-hidden sheet instead (robust even if the seller renames the tab).
  const sheet =
    workbook.worksheets.find((ws) => ws.state !== 'hidden' && ws.state !== 'veryHidden') ||
    workbook.worksheets[0];
  if (!sheet) {
    throw new AppError('Uploaded file has no worksheet', 400);
  }

  const [categories, commodities, userDefaultPaymentTerms] = await Promise.all([
    prisma.commodityCategory.findMany(),
    prisma.commodity.findMany(),
    getOwnerDefaultPaymentTerms(userId),
  ]);

  const rows = [];
  let readyRows = 0;

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const cells = row.values; // 1-indexed; cells[0] is unused
    const isEmpty = !cells || cells.slice(1).every((v) => v === null || v === undefined || v === '');
    if (isEmpty) {
      continue;
    }

    const raw = {
      category: cells[1],
      commodity: cells[2],
      quality: cells[3],
      quantityBags: cells[4],
      weightKg: cells[5],
      price: cells[6],
      paymentTerms: cells[7],
      notes: cells[8],
      moisture: cells[9],
      color: cells[10],
      size: cells[11],
    };

    const errors = [];

    const categoryMatch = matchName(raw.category, categories);
    const commodityCandidates =
      categoryMatch.match === 'exact' ? commodities.filter((c) => c.categoryId === categoryMatch.id) : commodities;
    const commodityMatch = matchName(raw.commodity, commodityCandidates);

    if (categoryMatch.match === 'unresolved') {
      errors.push('category not found — please select manually');
    }
    if (commodityMatch.match === 'unresolved') {
      errors.push('commodity not found — please select manually');
    }

    const quality = tryValidate(errors, () => optionalEnum(raw.quality, QUALITY_GRADES, 'quality'));
    const quantityBags = tryValidate(errors, () => requirePositiveInt(raw.quantityBags, 'quantityBags'));
    const weightKg = tryValidate(errors, () => optionalPositiveInt(raw.weightKg, 'weightKg'));
    const price = tryValidate(errors, () => optionalPositiveDecimal(raw.price, 'price'));
    // undefined => the cell was invalid (error already recorded); null => blank cell.
    const paymentTerms = tryValidate(errors, () => optionalNonNegativeInt(raw.paymentTerms, 'paymentTerms'));
    const notes = tryValidate(errors, () => optionalString(raw.notes, 'notes'));
    const moisture = tryValidate(errors, () => optionalString(raw.moisture, 'moisture'));
    const color = tryValidate(errors, () => optionalString(raw.color, 'color'));
    const size = tryValidate(errors, () => optionalString(raw.size, 'size'));

    const commodityRecord = commodityMatch.id ? commodities.find((c) => c.id === commodityMatch.id) : null;

    let willUpdateExisting = null;
    let existingPaymentTerms = null;
    if (categoryMatch.id && commodityMatch.id && errors.length === 0) {
      const existing = await prisma.listing.findFirst({
        where: {
          userId,
          side: 'SELL',
          categoryId: categoryMatch.id,
          commodityId: commodityMatch.id,
          weightKg: weightKg ?? null,
          quality: quality ?? null,
          status: { in: LIVE_STATUSES },
        },
        select: { id: true, paymentTerms: true },
      });
      willUpdateExisting = existing ? existing.id : null;
      existingPaymentTerms = existing ? existing.paymentTerms : null;
    }

    // Same precedence as bulkConfirmRows: the row's own value, else (blank cell on a
    // listing that will be updated) the listing's current value, else the profile default.
    let effectivePaymentTerms = null;
    let paymentTermsSource = null;
    if (paymentTerms !== undefined) {
      if (paymentTerms !== null) {
        effectivePaymentTerms = paymentTerms;
        paymentTermsSource = 'row';
      } else if (existingPaymentTerms !== null) {
        effectivePaymentTerms = existingPaymentTerms;
        paymentTermsSource = 'existing_listing';
      } else if (userDefaultPaymentTerms !== null) {
        effectivePaymentTerms = userDefaultPaymentTerms;
        paymentTermsSource = 'profile_default';
      } else {
        errors.push('paymentTerms missing — enter it in the sheet or set default payment terms in your profile');
      }
    }

    const ready = errors.length === 0 && Boolean(categoryMatch.id) && Boolean(commodityMatch.id);
    if (ready) {
      readyRows += 1;
    }

    rows.push({
      rowIndex: rowNumber,
      raw,
      resolved: {
        categoryId: categoryMatch.id,
        categoryMatch: categoryMatch.match,
        categorySuggestion: categoryMatch.suggestion,
        commodityId: commodityMatch.id,
        commodityMatch: commodityMatch.match,
        commoditySuggestion: commodityMatch.suggestion,
        itemName: commodityRecord ? commodityRecord.name : null,
        quality: quality ?? null,
        quantityBags: quantityBags ?? null,
        weightKg: weightKg ?? null,
        price: price ?? null,
        paymentTerms: effectivePaymentTerms,
        paymentTermsSource,
        notes: notes ?? null,
        moisture: moisture ?? null,
        color: color ?? null,
        size: size ?? null,
      },
      willUpdateExisting,
      errors,
      ready,
    });
  }

  return {
    summary: { totalRows: rows.length, readyRows, needsReviewRows: rows.length - readyRows },
    rows,
  };
}

async function bulkConfirmRows(userId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppError('rows must be a non-empty array', 400);
  }

  const created = [];
  const updated = [];
  const failed = [];
  const userDefaultPaymentTerms = await getOwnerDefaultPaymentTerms(userId);

  for (const row of rows) {
    const rowIndex = row.rowIndex;
    try {
      const categoryId = validateUuid(row.categoryId, 'categoryId');
      const commodityId = validateUuid(row.commodityId, 'commodityId');
      // Validates existence + category/commodity relationship; itemName is derived
      // inside createListing for the create path, and isn't touched on the update path.
      await fetchCategoryAndCommodity(categoryId, commodityId);

      const quality = optionalEnum(row.quality, QUALITY_GRADES, 'quality');
      const quantityBags = requirePositiveInt(row.quantityBags, 'quantityBags');
      const weightKg = optionalPositiveInt(row.weightKg, 'weightKg');
      const price = optionalPositiveDecimal(row.price, 'price');
      const paymentTerms = optionalNonNegativeInt(row.paymentTerms, 'paymentTerms');
      const notes = optionalString(row.notes, 'notes');
      const moisture = optionalString(row.moisture, 'moisture');
      const color = optionalString(row.color, 'color');
      const size = optionalString(row.size, 'size');

      const existing = await prisma.listing.findFirst({
        where: {
          userId,
          side: 'SELL',
          categoryId,
          commodityId,
          weightKg,
          quality,
          status: { in: LIVE_STATUSES },
        },
      });

      if (existing) {
        const data = {
          quantityBags,
          availabilityBags: quantityBags,
          // Blank cell keeps the listing's current terms (was: overwritten with null).
          paymentTerms: resolvePaymentTerms(paymentTerms ?? existing.paymentTerms, userDefaultPaymentTerms),
          notes,
          moisture,
          color,
          size,
        };
        if (price !== null) {
          data.price = price;
          data.status = 'active';
          data.priceValidUntil = await computeNextExpiryCutoff();
        }
        const listing = await prisma.listing.update({ where: { id: existing.id }, data });
        updated.push({ rowIndex, listingId: listing.id });
        continue;
      }

      const listing = await createListing(userId, {
        side: 'SELL',
        categoryId,
        commodityId,
        quality,
        quantityBags,
        weightKg,
        price,
        paymentTerms: resolvePaymentTerms(paymentTerms, userDefaultPaymentTerms),
        notes,
        moisture,
        color,
        size,
      });
      created.push({ rowIndex, listingId: listing.id });
    } catch (err) {
      failed.push({ rowIndex, reason: err.message || 'Unknown error' });
    }
  }

  return { created, updated, failed };
}

module.exports = {
  generateTemplateWorkbook,
  parseUploadedWorkbook,
  bulkConfirmRows,
};
