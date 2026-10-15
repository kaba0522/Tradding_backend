// Storage provider boundary. Everything Cloudinary-specific lives in this file
// so moving to S3/R2 later means rewriting only getUploadParams() and
// isOwnedUrl() — callers (media controller, listing validation) don't change.
const { v2: cloudinary } = require('cloudinary');
const { AppError } = require('../lib/errors');

const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];
const VIDEO_FORMATS = ['mp4', 'mov', 'webm'];

const MAX_PHOTOS_PER_LISTING = 5;
const MAX_VIDEOS_PER_LISTING = 1;

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

module.exports = {
  getUploadParams,
  isOwnedUrl,
  MAX_PHOTOS_PER_LISTING,
  MAX_VIDEOS_PER_LISTING,
};
