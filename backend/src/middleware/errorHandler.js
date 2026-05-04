export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;

  return res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    code: err.code || 'INTERNAL_SERVER_ERROR',
    details: err.details || null,
  });
}