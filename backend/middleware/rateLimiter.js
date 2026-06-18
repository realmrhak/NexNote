const rateLimit = require("express-rate-limit");
const { sendError } = require("../utils/apiResponse");

// ─── Configurable limits (env-overridable) ────────────────────────────────────
// PER FIX #1 (nexnote-ratelimit-fix.md):
//   - Auth limiter (login/register) is mounted ONLY on those two routes.
//   - /api/auth/refresh gets its OWN relaxed limiter (200/15min) because the
//     frontend fires it automatically on every page load / 401 retry — a
//     strict limit caused false-positive 429s for normal users.
//   - skipSuccessfulRequests: true on the auth limiter means successful
//     logins NEVER count against the budget (only failed brute-force attempts).
//   - All production limiters use a real-IP keyGenerator that reads
//     x-forwarded-for / x-real-ip so users behind Render's load balancer
//     (and Vercel's proxy) are NOT collapsed into a single IP bucket.
//   - In development (NODE_ENV !== 'production') every limiter's `max` is
//     bumped to a very high value so local testing with multiple accounts
//     from 127.0.0.1 never hits 429.
//
// RATE LIMIT INCREASE (Round 4): Users were hitting the global limiter too
// quickly during normal use (creating notes, toggling todos, switching tabs
// all fire API calls). Bumped:
//   - Global: 500 → 2000 / 15min per IP
//   - Auth:   50  → 100  / 15min per IP (still blocks brute-force)
//   - Refresh: 200 → 500 / 15min per IP (auto-fired, needs headroom)
// Production values can still be overridden via env vars.
const windowMs  = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000;
const isProd    = process.env.NODE_ENV === "production";
const maxGlobal = parseInt(process.env.RATE_LIMIT_MAX,       10) || (isProd ? 2000 : 100000);
const maxAuth   = parseInt(process.env.AUTH_RATE_LIMIT_MAX,  10) || (isProd ? 100  : 5000);
const maxRefresh= parseInt(process.env.REFRESH_RATE_LIMIT_MAX, 10) || (isProd ? 500  : 50000);

// ─── Real-IP key generator (Render + Vercel proxy aware) ──────────────────────
// Vercel front-ends all traffic, so the backend sees Vercel's outgoing IP
// for EVERY user. Without this keyGenerator, all Vercel users would share
// a single rate-limit bucket — exactly the bug described in the spec.
function realIpKeyGenerator(req) {
  return (
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.ip ||
    "unknown"
  );
}

// ─── Global limiter (covers everything under /api) ────────────────────────────
const globalLimiter = rateLimit({
  windowMs,
  max: maxGlobal,
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  keyGenerator: realIpKeyGenerator,
  handler: (_req, res, _next, options) => {
    res.set("Retry-After", Math.ceil(options.windowMs / 1000));
    return sendError(res, "Too many requests — please slow down.", 429);
  },
});

// ─── Auth limiter (login + register ONLY — never on /refresh) ─────────────────
const authLimiter = rateLimit({
  windowMs,
  max: maxAuth,
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  keyGenerator: realIpKeyGenerator,
  // Only count FAILED logins. A user who logs in 50 times in a row while
  // debugging will never hit 429.
  skipSuccessfulRequests: true,
  handler: (_req, res, _next, options) => {
    res.set("Retry-After", Math.ceil(options.windowMs / 1000));
    return sendError(
      res,
      "Too many login attempts. Please wait a few minutes before trying again.",
      429
    );
  },
});

// ─── Refresh limiter (relaxed — auto-fired by frontend) ───────────────────────
const refreshLimiter = rateLimit({
  windowMs,
  max: maxRefresh,
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true,
  keyGenerator: realIpKeyGenerator,
  handler: (_req, res, _next, options) => {
    res.set("Retry-After", Math.ceil(options.windowMs / 1000));
    return sendError(
      res,
      "Too many session refresh attempts — please log in again.",
      429
    );
  },
});

// ─── inviteLimiter — limits team invitation sends (20 per hour per user) ──────
const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?._id?.toString() || realIpKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    res.set("Retry-After", Math.ceil(options.windowMs / 1000));
    return sendError(res, "Too many invitations sent. Please wait before sending more.", 429);
  },
});

// ─── passwordResetLimiter — limits password reset/change requests ─────────────
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: realIpKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    res.set("Retry-After", Math.ceil(options.windowMs / 1000));
    return sendError(res, "Too many password change attempts. Please wait.", 429);
  },
});

module.exports = {
  globalLimiter,
  authLimiter,
  refreshLimiter,
  inviteLimiter,
  passwordResetLimiter,
  realIpKeyGenerator,
};
