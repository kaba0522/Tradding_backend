const commissionService = require('../services/commission.service');
const { sendSuccess } = require('../lib/response');

async function setCommission(req, res, next) {
  try {
    const result = await commissionService.setTradeCommission(req.params.id, req.body, req.user.id);
    sendSuccess(res, 200, result);
  } catch (err) {
    next(err);
  }
}

module.exports = { setCommission };
