const userService = require('../services/user.service');
const { sendSuccess } = require('../lib/response');
const { parsePagination, buildMeta } = require('../lib/pagination');

async function getMe(req, res, next) {
  try {
    const user = await userService.getOwnProfile(req.user.id);
    sendSuccess(res, 200, user);
  } catch (err) {
    next(err);
  }
}

async function updateMe(req, res, next) {
  try {
    const user = await userService.updateOwnProfile(req.user.id, req.body || {});
    sendSuccess(res, 200, user);
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const { page, limit, skip, take } = parsePagination(req.query);
    const { search, role, status } = req.query;
    const { data, total } = await userService.listUsers({ search, role, status, skip, take });
    sendSuccess(res, 200, data, buildMeta({ page, limit, total }));
  } catch (err) {
    next(err);
  }
}

module.exports = { getMe, updateMe, list };
