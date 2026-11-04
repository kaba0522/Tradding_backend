const ExcelJS = require('exceljs');
const stringSimilarity = require('string-similarity');
const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { validateUuid } = require('../lib/validators');
const {
  createListing,
  fetchCategoryAndCommodity,
  fetchQuality,
  computeNextExpiryCutoff,
  getOwnerDefaultPaymentTerms,
  resolvePaymentTerms,
  parseSide,
  writeAdminListingAudit,
  LISTING_INCLUDE,
} = require('./listing.service');
const {
  optionalString,
  requirePositiveInt,
  optionalPositiveInt,
  optionalNonNegativeInt,
  optionalNonNegativeDecimal,
} = require('./listing.validation');

const FUZZY_THRESHOLD = 0.6;
const TEMPLATE_DATA_ROWS = 500;
// One upload/confirm handles at most what the template holds.
const MAX_BULK_ROWS = TEMPLATE_DATA_ROWS;
// Must match the partial unique index's WHERE clause (uq_listing_no_duplicate_sell,
// last rebuilt in the quality_by_category migration).
const LIVE_STATUSES = ['active', 'na', 'price_expired'];
// A buy requirement has no price, so it is never `na` / `price_expired` — only
// `active` is live. There is no DB unique index for BUY; the match below is code-only.
const BUY_LIVE_STATUSES = ['active'];
// Fields a buy requirement does not have; a value in any of them fails the row.
const SELL_ONLY_FIELDS = ['weightKg', 'price', 'paymentTerms', 'notes', 'moisture', 'color', 'size'];

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
// A buy requirement is only these four: Category, Commodity, Quality, Quantity (Bags).
const BUY_COLUMNS = COLUMNS.slice(0, 4);

// The Excel flow is per file: the whole sheet is either SELL listings or BUY
// requirements. Absent => SELL (the behaviour before BUY uploads existed).
function parseBulkSide(side) {
  return side === undefined || side === null || side === '' ? 'SELL' : parseSide(side);
}

function columnsFor(side) {
  return side === 'BUY' ? BUY_COLUMNS : COLUMNS;
}

function hasValue(value) {
  return value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '');
}

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

async function generateTemplateWorkbook(side = 'SELL') {
  const [categories, commodities, qualities] = await Promise.all([
    prisma.commodityCategory.findMany({ orderBy: { name: 'asc' } }),
    prisma.commodity.findMany({ orderBy: { name: 'asc' } }),
    prisma.quality.findMany({ orderBy: { name: 'asc' } }),
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
  // Dependent dropdown: column (3 + i) holds only category i's commodities, exposed as
  // the defined name `cat_<i+1>`. The Commodity cell then does INDIRECT("cat_"&MATCH(...)),
  // so names with spaces/symbols never need sanitizing.
  categories.forEach((cat, i) => {
    const names = commodities.filter((c) => c.categoryId === cat.id).map((c) => c.name);
    names.forEach((name, j) => {
      listsSheet.getCell(j + 1, 3 + i).value = name;
    });
    const col = listsSheet.getColumn(3 + i).letter;
    workbook.definedNames.add(`_lists!$${col}$1:$${col}$${Math.max(names.length, 1)}`, `cat_${i + 1}`);
  });
  // Same trick for quality: columns after the commodity ones hold only category i's
  // qualities, exposed as `qual_<i+1>`. A per-category range (not an inline
  // "a,b,c" list) is also what keeps this working past Excel's 255-char inline limit.
  categories.forEach((cat, i) => {
    const names = qualities.filter((q) => q.categoryId === cat.id).map((q) => q.name);
    const colIndex = 3 + categories.length + i;
    names.forEach((name, j) => {
      listsSheet.getCell(j + 1, colIndex).value = name;
    });
    const col = listsSheet.getColumn(colIndex).letter;
    workbook.definedNames.add(`_lists!$${col}$1:$${col}$${Math.max(names.length, 1)}`, `qual_${i + 1}`);
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

  const sheet = workbook.addWorksheet(side === 'BUY' ? 'Requirements' : 'Listings');
  sheet.columns = columnsFor(side);

  const categoryRange = `_lists!$A$1:$A$${Math.max(categories.length, 1)}`;

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
      formulae: [`INDIRECT("cat_"&MATCH($A${row},${categoryRange},0))`],
      showErrorMessage: true,
      errorTitle: 'Invalid commodity',
      error: 'Please pick a category first, then a commodity from the dropdown list.',
    };
    sheet.getCell(`C${row}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [`INDIRECT("qual_"&MATCH($A${row},${categoryRange},0))`],
      showErrorMessage: true,
      errorTitle: 'Invalid quality',
      error: 'Please pick a category first, then a quality from the dropdown list.',
    };
  }

  return workbook;
}

// The SELL template has a Price column, the BUY template does not. Uploading one
// template with the other side selected would silently read the wrong columns, so
// it is rejected up front.
function checkTemplateMatchesSide(sheet, side) {
  const headers = (sheet.getRow(1).values || []).slice(1).map(normalize);
  const isSellTemplate = headers.includes('price');
  if (side === 'BUY' && isSellTemplate) {
    throw new AppError(
      'This file is the sell-listing template — download the buy-requirement template (side=BUY) or upload with side=SELL',
      400
    );
  }
  if (side === 'SELL' && !isSellTemplate) {
    throw new AppError(
      'This file is not the sell-listing template (no Price column) — download the template for side=SELL, or upload buy requirements with side=BUY',
      400
    );
  }
}

// userId = the listing owner (the seller/buyer; for an admin upload, the user the
// admin picked). byAdmin only changes error wording — the profile is the owner's.
async function parseUploadedWorkbook(buffer, userId, side = 'SELL', { byAdmin = false } = {}) {
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
  checkTemplateMatchesSide(sheet, side);
  const isBuy = side === 'BUY';

  const [categories, commodities, qualities, userDefaultPaymentTerms] = await Promise.all([
    prisma.commodityCategory.findMany(),
    prisma.commodity.findMany(),
    prisma.quality.findMany(),
    isBuy ? null : getOwnerDefaultPaymentTerms(userId),
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
    if (rows.length >= MAX_BULK_ROWS) {
      throw new AppError(`A file can contain at most ${MAX_BULK_ROWS} rows`, 400);
    }

    const raw = isBuy
      ? {
          category: cells[1],
          commodity: cells[2],
          quality: cells[3],
          quantityBags: cells[4],
        }
      : {
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
    // Qualities are category-scoped, so only the matched category's qualities are candidates.
    const qualityCandidates =
      categoryMatch.match === 'exact' ? qualities.filter((q) => q.categoryId === categoryMatch.id) : qualities;
    const qualityMatch = matchName(raw.quality, qualityCandidates);

    if (categoryMatch.match === 'unresolved') {
      errors.push('category not found — please select manually');
    }
    if (commodityMatch.match === 'unresolved') {
      errors.push('commodity not found — please select manually');
    }
    if (qualityMatch.match === 'unresolved') {
      const blank = typeof raw.quality !== 'string' || raw.quality.trim() === '';
      errors.push(blank ? 'quality is required' : 'quality not found — please select manually');
    }

    const quantityBags = tryValidate(errors, () => requirePositiveInt(raw.quantityBags, 'quantityBags'));
    // A BUY row has none of the SELL-only columns: they stay null and are left out
    // of `resolved` below.
    let weightKg = null;
    let price = null;
    let paymentTerms = null;
    let notes = null;
    let moisture = null;
    let color = null;
    let size = null;
    if (!isBuy) {
      weightKg = tryValidate(errors, () => optionalPositiveInt(raw.weightKg, 'weightKg'));
      // blank => null (no price given); 0 => explicit "clear the price" (row goes `na`).
      price = tryValidate(errors, () => optionalNonNegativeDecimal(raw.price, 'price'));
      // undefined => the cell was invalid (error already recorded); null => blank cell.
      paymentTerms = tryValidate(errors, () => optionalNonNegativeInt(raw.paymentTerms, 'paymentTerms'));
      notes = tryValidate(errors, () => optionalString(raw.notes, 'notes'));
      moisture = tryValidate(errors, () => optionalString(raw.moisture, 'moisture'));
      color = tryValidate(errors, () => optionalString(raw.color, 'color'));
      size = tryValidate(errors, () => optionalString(raw.size, 'size'));
    }

    const commodityRecord = commodityMatch.id ? commodities.find((c) => c.id === commodityMatch.id) : null;
    const qualityRecord = qualityMatch.id ? qualities.find((q) => q.id === qualityMatch.id) : null;

    let willUpdateExisting = null;
    let existingPaymentTerms = null;
    if (categoryMatch.id && commodityMatch.id && errors.length === 0) {
      const existing = await findExistingForRow(userId, side, {
        categoryId: categoryMatch.id,
        commodityId: commodityMatch.id,
        qualityId: qualityMatch.id,
        weightKg: weightKg ?? null,
      });
      willUpdateExisting = existing ? existing.id : null;
      existingPaymentTerms = existing ? existing.paymentTerms : null;
    }

    // Same precedence as bulkConfirmRows: the row's own value, else (blank cell on a
    // listing that will be updated) the listing's current value, else the profile default.
    let effectivePaymentTerms = null;
    let paymentTermsSource = null;
    if (!isBuy && paymentTerms !== undefined) {
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
        errors.push(
          byAdmin
            ? 'paymentTerms missing — this seller has no default payment terms, enter it in the sheet'
            : 'paymentTerms missing — enter it in the sheet or set default payment terms in your profile'
        );
      }
    }

    const ready =
      errors.length === 0 && Boolean(categoryMatch.id) && Boolean(commodityMatch.id) && Boolean(qualityMatch.id);
    if (ready) {
      readyRows += 1;
    }

    const resolved = {
      categoryId: categoryMatch.id,
      categoryMatch: categoryMatch.match,
      categorySuggestion: categoryMatch.suggestion,
      commodityId: commodityMatch.id,
      commodityMatch: commodityMatch.match,
      commoditySuggestion: commodityMatch.suggestion,
      itemName: commodityRecord ? commodityRecord.name : null,
      qualityId: qualityMatch.id,
      qualityMatch: qualityMatch.match,
      qualitySuggestion: qualityMatch.suggestion,
      quality: qualityRecord ? qualityRecord.name : null,
      quantityBags: quantityBags ?? null,
    };
    if (!isBuy) {
      Object.assign(resolved, {
        weightKg: weightKg ?? null,
        price: price ?? null,
        paymentTerms: effectivePaymentTerms,
        paymentTermsSource,
        notes: notes ?? null,
        moisture: moisture ?? null,
        color: color ?? null,
        size: size ?? null,
      });
    }

    rows.push({
      rowIndex: rowNumber,
      raw,
      resolved,
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

// The live listing a row would update instead of creating a new one.
//  SELL: same category + commodity + weight + quality (backed by the DB unique index).
//  BUY:  same category + commodity + quality (no weight on BUY; code-only match). If
//        older duplicates exist, the newest one is updated.
function findExistingForRow(userId, side, { categoryId, commodityId, qualityId, weightKg }) {
  if (side === 'BUY') {
    return prisma.listing.findFirst({
      where: { userId, side: 'BUY', categoryId, commodityId, qualityId, status: { in: BUY_LIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
      include: LISTING_INCLUDE,
    });
  }
  return prisma.listing.findFirst({
    where: { userId, side: 'SELL', categoryId, commodityId, weightKg, qualityId, status: { in: LIVE_STATUSES } },
    include: LISTING_INCLUDE,
  });
}

// userId = the listing owner. adminActorId is set when an admin confirms on the
// owner's behalf: every created/updated listing then gets an AuditLog entry.
async function bulkConfirmRows(userId, rows, side = 'SELL', { adminActorId = null } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppError('rows must be a non-empty array', 400);
  }
  if (rows.length > MAX_BULK_ROWS) {
    throw new AppError(`rows can contain at most ${MAX_BULK_ROWS} items`, 400);
  }
  const byAdmin = adminActorId !== null;

  const created = [];
  const updated = [];
  const failed = [];
  const userDefaultPaymentTerms = side === 'SELL' ? await getOwnerDefaultPaymentTerms(userId) : null;

  for (const row of rows) {
    const rowIndex = row.rowIndex;
    try {
      const categoryId = validateUuid(row.categoryId, 'categoryId');
      const commodityId = validateUuid(row.commodityId, 'commodityId');
      // Validates existence + category/commodity relationship; itemName is derived
      // inside createListing for the create path, and isn't touched on the update path.
      await fetchCategoryAndCommodity(categoryId, commodityId);
      const qualityId = validateUuid(row.qualityId, 'qualityId');
      await fetchQuality(categoryId, qualityId);

      const quantityBags = requirePositiveInt(row.quantityBags, 'quantityBags');

      if (side === 'BUY') {
        const sellOnly = SELL_ONLY_FIELDS.find((field) => hasValue(row[field]));
        if (sellOnly) {
          throw new AppError(`${sellOnly} is not allowed on a buy requirement`, 400);
        }
        const existing = await findExistingForRow(userId, 'BUY', { categoryId, commodityId, qualityId });
        if (existing) {
          const listing = await prisma.listing.update({
            where: { id: existing.id },
            data: { quantityBags, availabilityBags: quantityBags },
            include: LISTING_INCLUDE,
          });
          if (byAdmin) {
            await writeAdminListingAudit('LISTING_UPDATED_BY_ADMIN', adminActorId, existing, listing);
          }
          updated.push({ rowIndex, listingId: listing.id });
          continue;
        }
        const listing = await createListing(
          userId,
          { side: 'BUY', categoryId, commodityId, qualityId, quantityBags },
          { adminActorId }
        );
        created.push({ rowIndex, listingId: listing.id });
        continue;
      }

      const weightKg = optionalPositiveInt(row.weightKg, 'weightKg');
      const price = optionalNonNegativeDecimal(row.price, 'price');
      const paymentTerms = optionalNonNegativeInt(row.paymentTerms, 'paymentTerms');
      const notes = optionalString(row.notes, 'notes');
      const moisture = optionalString(row.moisture, 'moisture');
      const color = optionalString(row.color, 'color');
      const size = optionalString(row.size, 'size');

      const existing = await findExistingForRow(userId, 'SELL', { categoryId, commodityId, qualityId, weightKg });

      if (existing) {
        const data = {
          quantityBags,
          availabilityBags: quantityBags,
          // Blank cell keeps the listing's current terms (was: overwritten with null).
          paymentTerms: resolvePaymentTerms(
            paymentTerms ?? existing.paymentTerms,
            userDefaultPaymentTerms,
            byAdmin
          ),
          notes,
          moisture,
          color,
          size,
        };
        if (price === 0) {
          // Explicit 0 clears the price; a blank cell (null) leaves it alone.
          data.price = null;
          data.status = 'na';
          data.priceValidUntil = null;
        } else if (price !== null) {
          data.price = price;
          data.status = 'active';
          data.priceValidUntil = await computeNextExpiryCutoff();
        }
        const listing = await prisma.listing.update({ where: { id: existing.id }, data, include: LISTING_INCLUDE });
        if (byAdmin) {
          await writeAdminListingAudit('LISTING_UPDATED_BY_ADMIN', adminActorId, existing, listing);
        }
        updated.push({ rowIndex, listingId: listing.id });
        continue;
      }

      const listing = await createListing(
        userId,
        {
          side: 'SELL',
          categoryId,
          commodityId,
          qualityId,
          quantityBags,
          weightKg,
          // 0 on a new row = no price => createListing makes it `na`.
          price: price === 0 ? null : price,
          paymentTerms: resolvePaymentTerms(paymentTerms, userDefaultPaymentTerms, byAdmin),
          notes,
          moisture,
          color,
          size,
        },
        { adminActorId }
      );
      created.push({ rowIndex, listingId: listing.id });
    } catch (err) {
      failed.push({ rowIndex, reason: err.message || 'Unknown error' });
    }
  }

  return { created, updated, failed };
}

module.exports = {
  parseBulkSide,
  generateTemplateWorkbook,
  parseUploadedWorkbook,
  bulkConfirmRows,
};
