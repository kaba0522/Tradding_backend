const userService = require('../services/user.service');
const { sendSuccess } = require('../lib/response');

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

module.exports = { getMe, updateMe };
