var express = require('express');
var router = express.Router();
var multer = require('multer');
var { authenticate, requireRole, requireTosAccepted } = require('../middleware/auth');
var { AppError } = require('../lib/errors');
var freightController = require('../controllers/freight.controller');

var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: function (req, file, cb) {
    // Client-reported mimetype is unreliable (curl/some clients send
    // application/octet-stream for .xlsx), so accept on either mimetype or extension.
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

// Wraps multer so file-too-large / wrong-type errors reach errorHandler as a clean
// 400 instead of an unhandled 500 (multer's own errors aren't AppErrors).
function handleUploadFile(req, res, next) {
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

// Everyone logged in can read; the controller hides expired prices from non-admins.
router.get('/', freightController.list);

// Fixed paths must stay above '/:id' routes.
router.get('/template', requireRole(['admin']), freightController.downloadTemplate);
router.post('/upload/preview', requireRole(['admin']), handleUploadFile, freightController.uploadPreview);
router.post('/upload/commit', requireRole(['admin']), handleUploadFile, freightController.uploadCommit);

router.post('/', requireRole(['admin']), freightController.create);
router.patch('/:id', requireRole(['admin']), freightController.update);
router.delete('/:id', requireRole(['admin']), freightController.remove);

module.exports = router;
