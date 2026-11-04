var express = require('express');
var router = express.Router();
var { authenticate, requireRole, requireTosAccepted } = require('../middleware/auth');
var commissionController = require('../controllers/commission.controller');

// Commission rates are per commodity category and only an admin sets them.
router.use(authenticate, requireTosAccepted, requireRole(['admin']));

router.get('/', commissionController.list);
router.put('/:categoryId', commissionController.set);
router.delete('/:categoryId', commissionController.remove);

module.exports = router;
