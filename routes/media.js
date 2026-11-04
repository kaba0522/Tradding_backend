var express = require('express');
var router = express.Router();
var { authenticate, requireTosAccepted, readOnlyForRoles } = require('../middleware/auth');
var mediaController = require('../controllers/media.controller');

router.use(authenticate, requireTosAccepted);
// Media upload only serves listing creation, which a broker cannot do.
router.use(readOnlyForRoles(['broker']));

router.post('/sign', mediaController.sign);

module.exports = router;
