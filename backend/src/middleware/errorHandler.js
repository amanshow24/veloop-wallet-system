function notFoundHandler(_req, res) {
  res.status(404).json({
    success: false,
    message: 'Route not found.',
  });
}

function errorHandler(error, _req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error.code === 11000) {
    res.status(409).json({
      success: false,
      message: 'An account with this email already exists.',
    });
    return;
  }

  if (error.type === 'entity.parse.failed') {
    res.status(400).json({
      success: false,
      message: 'Invalid JSON request body.',
    });
    return;
  }

  if (error.type === 'entity.too.large') {
    res.status(413).json({
      success: false,
      message: 'Request body is too large.',
    });
    return;
  }

  const statusCode = Number.isInteger(error.statusCode)
    ? error.statusCode
    : Number.isInteger(error.status)
      ? error.status
      : 500;
  const message =
    statusCode >= 500 ? 'An unexpected error occurred.' : error.message;

  if (statusCode >= 500) {
    console.error('Unhandled API error:', error.name);
  }

  res.status(statusCode).json({ success: false, message });
}

module.exports = { errorHandler, notFoundHandler };
