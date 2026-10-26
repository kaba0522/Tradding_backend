const brokerService = require('../services/broker.service');
const { sendSuccess } = require('../lib/response');
const { parsePagination, buildMeta } = require('../lib/pagination');

async function create(req, res, next) {
  try {
    const broker = await brokerService.createBroker(req.body, req.user.id);
    sendSuccess(res, 201, broker);
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const { search, active } = req.query;
    const { page, limit, skip, take } = parsePagination(req.query);
    const { data, total } = await brokerService.listBrokers({ search, active, skip, take });
    sendSuccess(res, 200, data, buildMeta({ page, limit, total }));
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const broker = await brokerService.getBrokerById(req.params.id);
    sendSuccess(res, 200, broker);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const broker = await brokerService.updateBroker(req.params.id, req.body, req.user.id);
    sendSuccess(res, 200, broker);
  } catch (err) {
    next(err);
  }
}

// Soft delete: returns the now-inactive broker rather than 204, so the admin
// panel can update the row in place.
async function remove(req, res, next) {
  try {
    const broker = await brokerService.deactivateBroker(req.params.id, req.user.id);
    sendSuccess(res, 200, broker);
  } catch (err) {
    next(err);
  }
}

async function reactivate(req, res, next) {
  try {
    const broker = await brokerService.reactivateBroker(req.params.id, req.user.id);
    sendSuccess(res, 200, broker);
  } catch (err) {
    next(err);
  }
}

module.exports = { create, list, getById, update, remove, reactivate };
