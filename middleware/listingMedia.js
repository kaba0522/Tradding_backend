const prisma = require('../lib/prisma');
const { AppError } = require('../lib/errors');
const { validateUuid } = require('../lib/validators');
const storageService = require('../services/storage.service');

// Media rules for SELL listings, applied BEFORE the existing create/update handlers
// (listing.service.js / listing.validation.js are untouched). It only inspects
// photoUrls / videoUrls; every other field still goes through the existing validation.
//
//  - at most 5 photos and 1 video per listing
//  - every URL must point at our Cloudinary account (uploaded via POST /media/sign)
//  - every NEW url must exist in storage, sit in the caller's folder and be within
//    the size limit (checked against Cloudinary, never trusted from the client)
//
// Values that aren't arrays / strings are skipped here: the existing validation
// already rejects those with its own message.
const FIELDS = [
  { key: 'photoUrls', max: storageService.MAX_PHOTOS_PER_LISTING },
  { key: 'videoUrls', max: storageService.MAX_VIDEOS_PER_LISTING },
];

function checkShape(body) {
  for (const { key, max } of FIELDS) {
    const value = body[key];
    if (!Array.isArray(value)) {
      continue;
    }
    if (value.length > max) {
      throw new AppError(`${key} can contain at most ${max} items`, 400);
    }
  }
}

function checkOwned(body, alreadySaved) {
  for (const { key } of FIELDS) {
    const value = body[key];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const url of value) {
      if (typeof url !== 'string' || alreadySaved[key].includes(url)) {
        continue;
      }
      if (!storageService.isOwnedUrl(url)) {
        throw new AppError(`${key} must contain URLs uploaded via /media/sign`, 400);
      }
    }
  }
}

function newUrls(body, key, alreadySaved) {
  const value = body[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((url) => typeof url === 'string' && !alreadySaved[key].includes(url));
}

async function verify(req, alreadySaved) {
  const body = req.body || {};
  checkShape(body);
  checkOwned(body, alreadySaved);
  await storageService.verifyMedia({
    userId: req.user.id,
    photoUrls: newUrls(body, 'photoUrls', alreadySaved),
    videoUrls: newUrls(body, 'videoUrls', alreadySaved),
  });
}

const NOTHING_SAVED = { photoUrls: [], videoUrls: [] };

// POST /listings — media only exists on SELL listings.
async function guardCreate(req, res, next) {
  try {
    if (req.body && req.body.side === 'BUY') {
      return next();
    }
    await verify(req, NOTHING_SAVED);
    next();
  } catch (err) {
    next(err);
  }
}

// PATCH /listings/:id — URLs already saved on the listing are not re-verified.
async function guardUpdate(req, res, next) {
  try {
    const body = req.body || {};
    if (body.photoUrls === undefined && body.videoUrls === undefined) {
      return next();
    }
    validateUuid(req.params.id, 'id');
    const existing = await prisma.listing.findUnique({
      where: { id: req.params.id },
      select: { photoUrls: true, videoUrls: true },
    });
    // Unknown id: let the existing handler answer with its own 404.
    await verify(req, existing || NOTHING_SAVED);
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { guardCreate, guardUpdate };
