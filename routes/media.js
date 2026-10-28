var express = require('express');
var router = express.Router();
var { authenticate, requireTosAccepted } = require('../middleware/auth');
var mediaController = require('../controllers/media.controller');

router.use(authenticate, requireTosAccepted);

router.post('/sign', mediaController.sign);

module.exports = router;
