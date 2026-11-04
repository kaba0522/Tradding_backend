var express = require('express');
var router = express.Router();
var { authenticate, requireRole, requireTosAccepted } = require('../middleware/auth');
var brokerController = require('../controllers/broker.controller');

router.use(authenticate, requireTosAccepted);

// The trade-accept dropdown: active brokers, id and name only. Buyers and sellers pick
// from it; a broker never confirms a trade, so there is nothing for them to pick.
// These fixed paths must come before '/:id' — otherwise Express would read "options"
// or "me" as an id.
router.get('/options', requireRole(['buyer', 'seller', 'admin']), brokerController.options);

// A broker's own trades (read-only).
router.get('/me/trades', requireRole(['broker']), brokerController.listMyTrades);
router.get('/me/trades/:id', requireRole(['broker']), brokerController.getMyTrade);

// Everything below manages the broker list and is admin-only (CLAUDE.md §4.4 Settings).
router.use(requireRole(['admin']));

router.post('/', brokerController.create);
router.get('/', brokerController.list);
router.get('/:id', brokerController.getById);
router.patch('/:id/reactivate', brokerController.reactivate);
router.patch('/:id', brokerController.update);
router.delete('/:id', brokerController.remove);

module.exports = router;
