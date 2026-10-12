var express = require('express');
var router = express.Router();
var { authenticate } = require('../middleware/auth');
var userController = require('../controllers/user.controller');

router.use(authenticate);

router.get('/me', userController.getMe);
router.patch('/me', userController.updateMe);

module.exports = router;
