const freightService = require('../services/freight.service');
const { sendSuccess } = require('../lib/response');
const { AppError } = require('../lib/errors');

// Same endpoint for everyone; the server decides what each caller may see
// (admins get the last price of expired routes, everyone else gets null).
async function list(req, res, next) {
  try {
    const { origin, destination } = req.query;
    const isAdmin = req.user.roles.includes('admin');
    const data = await freightService.listGrouped({ origin, destination, isAdmin });
    sendSuccess(res, 200, data);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const route = await freightService.createRoute(req.body, req.user.id);
    sendSuccess(res, 201, route);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const route = await freightService.updateRoute(req.params.id, req.body, req.user.id);
    sendSuccess(res, 200, route);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    await freightService.deleteRoute(req.params.id, req.user.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function downloadTemplate(req, res, next) {
  try {
    const workbook = freightService.generateTemplateWorkbook();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="freight-template.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
}

async function uploadPreview(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError('file is required', 400);
    }
    const result = await freightService.previewUpload(req.file.buffer);
    sendSuccess(res, 200, result);
  } catch (err) {
    next(err);
  }
}

async function uploadCommit(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError('file is required', 400);
    }
    const result = await freightService.commitUpload(req.file.buffer, req.user.id);
    sendSuccess(res, 200, result);
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, remove, downloadTemplate, uploadPreview, uploadCommit };
