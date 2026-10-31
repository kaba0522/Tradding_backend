var express = require('express');
var router = express.Router();
var { authenticate, requireRole, requireTosAccepted } = require('../middleware/auth');
var qualityController = require('../controllers/quality.controller');

router.use(authenticate, requireTosAccepted);

router.post('/', requireRole(['admin']), qualityController.create);
router.get('/', qualityController.list);
router.patch('/:id', requireRole(['admin']), qualityController.update);
router.delete('/:id', requireRole(['admin']), qualityController.remove);

module.exports = router;
