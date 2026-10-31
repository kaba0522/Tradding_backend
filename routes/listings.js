var express = require('express');
var router = express.Router();
var multer = require('multer');
var { authenticate, requireRole, requireTosAccepted } = require('../middleware/auth');
var { AppError } = require('../lib/errors');
var listingController = require('../controllers/listing.controller');
var listingBulkController = require('../controllers/listing-bulk.controller');
var listingMedia = require('../middleware/listingMedia');

var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: function (req, file, cb) {
    // Client-reported mimetype is unreliable (curl/some mobile clients send
    // application/octet-stream for .xlsx), so fall back to checking the
    // extension too — accept if either looks right.
    var allowedMimetypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
    ];
    var hasXlsxExtension = /\.xlsx$/i.test(file.originalname || '');
    if (!allowedMimetypes.includes(file.mimetype) && !hasXlsxExtension) {
      return cb(new AppError('Only .xlsx files are allowed', 400));
    }
    cb(null, true);
  },
});

// Wraps multer so file-too-large / wrong-mimetype errors reach errorHandler as a
// clean 400 instead of an unhandled 500 (multer's own errors aren't AppErrors).
function handleBulkUploadFile(req, res, next) {
  upload.single('file')(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      return next(new AppError(err.message, 400));
    }
    if (err) {
      return next(err);
    }
    next();
  });
}

router.use(authenticate, requireTosAccepted);

// Photo/video rules run before the existing create/update handlers (added, not edited).
router.post('/', listingMedia.guardCreate);
router.patch('/:id', listingMedia.guardUpdate);

router.post('/', listingController.create);
router.get('/', listingController.list);
// Must come before '/:id' — otherwise Express would match "template" as :id.
router.get('/template', listingBulkController.downloadTemplate);
router.get('/:id', listingController.getById);
// Must come before '/:id' — otherwise Express would match "bulk-price" as :id.
router.patch('/bulk-price', listingController.bulkPrice);
router.patch('/:id/withdraw', listingController.withdraw);
router.patch('/:id/force-expire', requireRole(['admin']), listingController.forceExpire);
router.patch('/:id', listingController.update);
router.post('/bulk-upload', handleBulkUploadFile, listingBulkController.bulkUpload);
router.post('/bulk-confirm', listingBulkController.bulkConfirm);

module.exports = router;
