const { verifyAccessToken } = require("../utils/tokenUtils");
const { sendError }         = require("../utils/apiResponse");
const User                  = require("../models/User");

async function protect(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return sendError(res, "Authentication required. Please log in.", 401);
    }

    const token = authHeader.split(" ")[1];
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === "TokenExpiredError")
        return sendError(res, "Session expired. Please log in again.", 401);
      return sendError(res, "Invalid token. Please log in again.", 401);
    }

    const user = await User.findById(decoded.id).select("-password -refreshToken");
    if (!user || !user.isActive)
      return sendError(res, "User not found or account deactivated.", 401);

    req.user = user;
    next();
  } catch (err) { next(err); }
}

async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) return next();
    const token = authHeader.split(" ")[1];
    try {
      const decoded = verifyAccessToken(token);
      const user    = await User.findById(decoded.id).select("-password -refreshToken");
      if (user && user.isActive) req.user = user;
    } catch { /* swallow — optional */ }
    next();
  } catch (err) { next(err); }
}

module.exports = { protect, optionalAuth };
