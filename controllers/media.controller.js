const storageService = require('../services/storage.service');
const { AppError } = require('../lib/errors');
const { sendSuccess } = require('../lib/response');

const RESOURCE_TYPES = ['image', 'video'];

async function sign(req, res, next) {
  try {
    const { resourceType } = req.body;
    if (!RESOURCE_TYPES.includes(resourceType)) {
      throw new AppError(`resourceType must be one of: ${RESOURCE_TYPES.join(', ')}`, 400);
    }
    const params = storageService.getUploadParams({ userId: req.user.id, resourceType });
    sendSuccess(res, 200, params);
  } catch (err) {
    next(err);
  }
}

module.exports = { sign };
