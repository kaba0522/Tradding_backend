const listingService = require('../services/listing.service');
const { sendSuccess } = require('../lib/response');
const { parsePagination, buildMeta } = require('../lib/pagination');

async function create(req, res, next) {
  try {
    const listing = await listingService.createListing(req.user.id, req.body);
    sendSuccess(res, 201, listing);
  } catch (err) {
    next(err);
  }
}

async function list(req, res, next) {
  try {
    const {
      side,
      categoryId,
      commodityId,
      status,
      userId,
      itemName,
      createdFrom,
      createdTo,
      minPrice,
      maxPrice,
    } = req.query;
    const { page, limit, skip, take } = parsePagination(req.query);
    const { data, total } = await listingService.getListings({
      side,
      categoryId,
      commodityId,
      status,
      userId,
      itemName,
      createdFrom,
      createdTo,
      minPrice,
      maxPrice,
      skip,
      take,
      requestingUser: req.user,
    });
    sendSuccess(res, 200, data, buildMeta({ page, limit, total }));
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const { id } = req.params;
    const listing = await listingService.getListingById(id);
    sendSuccess(res, 200, listing);
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const listing = await listingService.updateListing(id, req.user.id, req.body, req.user);
    sendSuccess(res, 200, listing);
  } catch (err) {
    next(err);
  }
}

async function bulkPrice(req, res, next) {
  try {
    const result = await listingService.bulkUpdatePrice(req.user.id, req.body);
    sendSuccess(res, 200, result);
  } catch (err) {
    next(err);
  }
}

async function withdraw(req, res, next) {
  try {
    const { id } = req.params;
    const listing = await listingService.withdrawListing(id, req.user.id, req.user);
    sendSuccess(res, 200, listing);
  } catch (err) {
    next(err);
  }
}

async function forceExpire(req, res, next) {
  try {
    const { id } = req.params;
    const listing = await listingService.forceExpireListing(id, req.user.id);
    sendSuccess(res, 200, listing);
  } catch (err) {
    next(err);
  }
}

module.exports = { create, list, getById, update, bulkPrice, withdraw, forceExpire };
