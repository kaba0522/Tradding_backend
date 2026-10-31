const auditService = require('../services/audit.service');
const { parseListFilters } = require('../services/audit.validation');
const { sendSuccess } = require('../lib/response');
const { parsePagination, buildMeta } = require('../lib/pagination');

async function list(req, res, next) {
  try {
    const { page, limit, skip, take } = parsePagination(req.query);
    const filters = parseListFilters(req.query);
    const { data, total } = await auditService.listAuditLogs({ skip, take, filters });
    sendSuccess(res, 200, data, buildMeta({ page, limit, total }));
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const entry = await auditService.getAuditLog(req.params.id);
    sendSuccess(res, 200, entry);
  } catch (err) {
    next(err);
  }
}

async function filters(req, res, next) {
  try {
    const options = await auditService.getFilterOptions();
    sendSuccess(res, 200, options);
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getById, filters };
