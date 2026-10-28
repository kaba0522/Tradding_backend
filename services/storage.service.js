// Storage provider boundary. Everything Cloudinary-specific lives in this file
// so moving to S3/R2 later means rewriting only getUploadParams() and
// isOwnedUrl() — callers (media controller, listing validation) don't change.
const { v2: cloudinary } = require('cloudinary');
const { AppError } = require('../lib/errors');

const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];
const VIDEO_FORMATS = ['mp4', 'mov', 'webm'];

const MAX_PHOTOS_PER_LISTING = 5;
const MAX_VIDEOS_PER_LISTING = 1;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB

function getConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new AppError('Media storage is not configured', 500);
  }
  return { cloudName, apiKey, apiSecret };
}

// Returns what the client needs to upload one file DIRECTLY to Cloudinary
// (the file never passes through this server). The signature binds the
// timestamp/folder/allowed_formats, so the client can't change them.
function getUploadParams({ userId, resourceType }) {
  const { cloudName, apiKey, apiSecret } = getConfig();
  const timestamp = Math.round(Date.now() / 1000);
  const folder = `listings/${userId}`;
  const allowedFormats = (resourceType === 'video' ? VIDEO_FORMATS : IMAGE_FORMATS).join(',');

  const paramsToSign = { timestamp, folder, allowed_formats: allowedFormats };
  const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    apiKey,
    signature,
    ...paramsToSign,
  };
}

// True if the URL points at our own storage. Used to reject arbitrary
// external URLs in photoUrls/videoUrls.
function isOwnedUrl(url) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) {
    return false;
  }
  return url.startsWith(`https://res.cloudinary.com/${cloudName}/`);
}

// Pulls resource type + public_id out of a Cloudinary delivery URL:
// https://res.cloudinary.com/<cloud>/<resource_type>/upload/v123/<public_id>.<ext>
// URLs with transformations (no /v<digits>/ right after /upload/) are rejected —
// we only ever store the original URL returned by the upload.
function parseUrl(url) {
  const match = /^https:\/\/res\.cloudinary\.com\/[^/]+\/(image|video)\/upload\/v\d+\/(.+)\.[A-Za-z0-9]+$/.exec(url);
  if (!match) {
    return null;
  }
  return { resourceType: match[1], publicId: match[2] };
}

function configureAdminApi() {
  const { cloudName, apiKey, apiSecret } = getConfig();
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
}

// The size is read from Cloudinary itself (server-to-server, signed with the API
// secret) — never trusted from the client, since uploads bypass this server.
async function checkOne(url, expectedType, userId) {
  const parsed = parseUrl(url);
  if (!parsed || parsed.resourceType !== expectedType) {
    throw new AppError(`${expectedType} URL is not a valid uploaded ${expectedType}: ${url}`, 400);
  }
  if (!parsed.publicId.startsWith(`listings/${userId}/`)) {
    throw new AppError('Media must be uploaded by the listing owner', 400);
  }

  let resource;
  try {
    resource = await cloudinary.api.resource(parsed.publicId, { resource_type: expectedType });
  } catch (err) {
    const httpCode = err && (err.http_code || (err.error && err.error.http_code));
    if (httpCode === 404) {
      throw new AppError(`${expectedType} not found in storage: ${url}`, 400);
    }
    throw new AppError('Could not verify uploaded media, please try again', 502);
  }

  const maxBytes = expectedType === 'video' ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
  if (resource.bytes > maxBytes) {
    // Best-effort cleanup so the oversize file doesn't sit in storage.
    try {
      await cloudinary.api.delete_resources([parsed.publicId], { resource_type: expectedType });
    } catch (err) {
      // ignore — the 400 below is what matters to the caller
    }
    const maxMb = maxBytes / (1024 * 1024);
    throw new AppError(`${expectedType} must be at most ${maxMb} MB`, 400);
  }
}

// Verifies every given URL exists in our storage, belongs to userId's folder and
// is within the size limit. Pass only NEW urls on update (already-saved ones were
// verified when they were first attached).
async function verifyMedia({ userId, photoUrls = [], videoUrls = [] }) {
  if (photoUrls.length === 0 && videoUrls.length === 0) {
    return;
  }
  configureAdminApi();
  await Promise.all([
    ...photoUrls.map((url) => checkOne(url, 'image', userId)),
    ...videoUrls.map((url) => checkOne(url, 'video', userId)),
  ]);
}

module.exports = {
  verifyMedia,
  getUploadParams,
  isOwnedUrl,
  MAX_PHOTOS_PER_LISTING,
  MAX_VIDEOS_PER_LISTING,
};
