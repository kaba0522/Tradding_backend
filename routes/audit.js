var express = require('express');
var router = express.Router();
var { authenticate, requireRole, requireTosAccepted } = require('../middleware/auth');
var auditController = require('../controllers/audit.controller');

// Audit log is read-only and admin-only (CLAUDE.md §4.4 item 7). There is
// intentionally no create/update/delete endpoint.
router.use(authenticate, requireTosAccepted, requireRole(['admin']));

// /filters must be registered before /:id or it would be read as an id.
router.get('/filters', auditController.filters);
router.get('/', auditController.list);
router.get('/:id', auditController.getById);

module.exports = router;
