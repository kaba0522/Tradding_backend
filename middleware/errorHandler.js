const { AppError } = require('../lib/errors');

const DEFAULT_CODES = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  500: 'INTERNAL_ERROR',
};

function errorHandler(err, req, res, next) {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = (isAppError && err.code) || DEFAULT_CODES[statusCode] || 'INTERNAL_ERROR';

  // Unexpected (non-AppError) failures are logged in full server-side, but the
  // client only ever gets a generic message — raw DB/driver errors shouldn't leak.
  const message = isAppError ? err.message : 'Internal Server Error';
  if (!isAppError) {
    console.error(err);
  }

  const error = { code, message };
  // Optional structured detail (e.g. per-row Excel errors); only AppErrors set it.
  if (isAppError && err.details !== undefined) {
    error.details = err.details;
  }

  res.status(statusCode).json({ success: false, error });
}

module.exports = errorHandler;
