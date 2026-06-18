const logger = require("../utils/logger");

function notFound(req, res, next) {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.statusCode = 404;
  next(err);
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || err.status || 500;
  if (statusCode >= 500 || process.env.NODE_ENV !== "production")
    logger.error(`${req.method} ${req.originalUrl} — ${err.message}`, { stack: err.stack });

  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return res.status(422).json({ success: false, message: "Validation error", errors });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || "field";
    return res.status(409).json({ success: false, message: `${field} already exists.` });
  }
  if (err.name === "CastError")
    return res.status(400).json({ success: false, message: `Invalid ${err.path}` });
  if (err.name === "JsonWebTokenError")
    return res.status(401).json({ success: false, message: "Invalid token." });
  if (err.name === "TokenExpiredError")
    return res.status(401).json({ success: false, message: "Session expired." });

  const message =
    process.env.NODE_ENV === "production" && statusCode === 500
      ? "An unexpected error occurred."
      : err.message || "Internal Server Error";

  return res.status(statusCode).json({ success: false, message });
}

module.exports = { notFound, errorHandler };
