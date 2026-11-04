var express = require('express');
var router = express.Router();
var { authenticate, requireRole, requireTosAccepted } = require('../middleware/auth');
var userController = require('../controllers/user.controller');

router.use(authenticate);

// Admin-only user picker (admin creates listings on behalf of a seller/buyer).
// '/me' stays outside the ToS gate: onboarding calls it before accepting.
router.get('/', requireTosAccepted, requireRole(['admin']), userController.list);
router.get('/me', userController.getMe);
router.patch('/me', userController.updateMe);

module.exports = router;
