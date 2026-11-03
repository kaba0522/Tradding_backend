var express = require('express');
var router = express.Router();
var { authenticate, requireRole } = require('../middleware/auth');
var inviteController = require('../controllers/invite.controller');

// Only an admin invites people; a broker is invited automatically when the admin adds them.
router.use(authenticate, requireRole(['admin']));

router.post('/', inviteController.sendInvitation);
router.get('/', inviteController.listInvitations);
router.patch('/:id/cancel', inviteController.cancelInvitation);

module.exports = router;
