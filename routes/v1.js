var express = require('express');
var router = express.Router();
var { AppError } = require('../lib/errors');
var errorHandler = require('../middleware/errorHandler');

var invitesRouter = require('./invites');
var authRouter = require('./auth');
var tosVersionsRouter = require('./tosVersions');
var tosRouter = require('./tos');
var commodityCategoriesRouter = require('./commodityCategories');
var commoditiesRouter = require('./commodities');
var settingsRouter = require('./settings');
var listingsRouter = require('./listings');
var usersRouter = require('./users');
var freightRouter = require('./freight');

router.use('/invites', invitesRouter);
router.use('/auth', authRouter);
router.use('/tos-versions', tosVersionsRouter);
router.use('/tos', tosRouter);
router.use('/commodity-categories', commodityCategoriesRouter);
router.use('/commodities', commoditiesRouter);
router.use('/settings', settingsRouter);
router.use('/listings', listingsRouter);
router.use('/users', usersRouter);
router.use('/freight', freightRouter);

router.use((req, res, next) => next(new AppError('Not found', 404)));
router.use(errorHandler);

module.exports = router;
