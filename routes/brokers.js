var express = require('express');
var router = express.Router();
var { authenticate, requireRole, requireTosAccepted } = require('../middleware/auth');
var brokerController = require('../controllers/broker.controller');

// Broker list management is admin-only (CLAUDE.md §4.4 Settings). Who else may
// read it (broker role, trade-accept dropdown) is still to be decided.
router.use(authenticate, requireTosAccepted, requireRole(['admin']));

router.post('/', brokerController.create);
router.get('/', brokerController.list);
router.get('/:id', brokerController.getById);
router.patch('/:id/reactivate', brokerController.reactivate);
router.patch('/:id', brokerController.update);
router.delete('/:id', brokerController.remove);

module.exports = router;
