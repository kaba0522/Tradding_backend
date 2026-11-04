const listingBulkService = require('../services/listing-bulk.service');
const { resolveListingOwner } = require('../services/listing.service');
const { sendSuccess } = require('../lib/response');
const { AppError } = require('../lib/errors');

async function downloadTemplate(req, res, next) {
  try {
    const side = listingBulkService.parseBulkSide(req.query.side);
    const workbook = await listingBulkService.generateTemplateWorkbook(side);
    const filename = side === 'BUY' ? 'requirement-bulk-template.xlsx' : 'listing-bulk-template.xlsx';
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
}

// multipart/form-data: file + optional text fields `side` (SELL|BUY, default SELL)
// and `ownerUserId` (required for an admin, see resolveListingOwner).
async function bulkUpload(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError('file is required', 400);
    }
    const body = req.body || {};
    const side = listingBulkService.parseBulkSide(body.side);
    const { ownerId, byAdmin } = await resolveListingOwner(req.user, body.ownerUserId, side);
    const result = await listingBulkService.parseUploadedWorkbook(req.file.buffer, ownerId, side, { byAdmin });
    sendSuccess(res, 200, { side, ownerUserId: ownerId, ...result });
  } catch (err) {
    next(err);
  }
}

// The owner checks run again here — the preview response is never trusted.
async function bulkConfirm(req, res, next) {
  try {
    const { rows, ownerUserId } = req.body || {};
    const side = listingBulkService.parseBulkSide((req.body || {}).side);
    const { ownerId, byAdmin } = await resolveListingOwner(req.user, ownerUserId, side);
    const result = await listingBulkService.bulkConfirmRows(ownerId, rows, side, {
      adminActorId: byAdmin ? req.user.id : null,
    });
    sendSuccess(res, 200, result);
  } catch (err) {
    next(err);
  }
}

module.exports = { downloadTemplate, bulkUpload, bulkConfirm };
