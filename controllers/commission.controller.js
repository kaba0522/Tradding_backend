const commissionService = require('../services/commission.service');
const { sendSuccess } = require('../lib/response');

async function list(req, res, next) {
  try {
    const data = await commissionService.listCategoryCommissions();
    sendSuccess(res, 200, data);
  } catch (err) {
    next(err);
  }
}

async function set(req, res, next) {
  try {
    const commission = await commissionService.setCategoryCommission(req.params.categoryId, req.body, req.user.id);
    sendSuccess(res, 200, commission);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    await commissionService.removeCategoryCommission(req.params.categoryId, req.user.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, set, remove };
