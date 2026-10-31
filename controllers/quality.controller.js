const qualityService = require('../services/quality.service');
const { sendSuccess } = require('../lib/response');
const { parsePagination, buildMeta } = require('../lib/pagination');
const { AppError } = require('../lib/errors');

// `name` adds one quality (returns the row); `names` adds many (returns
// { created, skipped }). Exactly one of the two must be sent.
async function create(req, res, next) {
  try {
    const { categoryId, name, names } = req.body;
    if (names !== undefined && name !== undefined) {
      return next(new AppError('Send either name or names, not both', 400));
    }
    if (names !== undefined) {
      const result = await qualityService.createQualitiesBulk(categoryId, names, req.user.id);
      return sendSuccess(res, 201, result);
    }
    const quality = await qualityService.createQuality(categoryId, name, req.user.id);
    return sendSuccess(res, 201, quality);
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const { categoryId, name } = req.query;
    const { page, limit, skip, take } = parsePagination(req.query);
    const { data, total } = await qualityService.listQualities({ categoryId, name, skip, take });
    sendSuccess(res, 200, data, buildMeta({ page, limit, total }));
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const quality = await qualityService.updateQuality(id, { name }, req.user.id);
    sendSuccess(res, 200, quality);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    await qualityService.deleteQuality(id, req.user.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { create, list, update, remove };
