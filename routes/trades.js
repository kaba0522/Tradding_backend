var express = require('express');
var router = express.Router();
var { authenticate, requireRole, requireTosAccepted } = require('../middleware/auth');
var tradeController = require('../controllers/trade.controller');

// Only the admin-side trade action exists so far: filling in the commission of a
// trade that was confirmed without a category rate ("not_set").
router.use(authenticate, requireTosAccepted, requireRole(['admin']));

router.patch('/:id/commission', tradeController.setCommission);

module.exports = router;
