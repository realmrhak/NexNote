const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/authController");
const { protect }             = require("../middleware/auth");
const { authLimiter, refreshLimiter, passwordResetLimiter } = require("../middleware/rateLimiter");
const { validate, sanitize, registerRules, loginRules, changePasswordRules } = require("../middleware/validators");
const { body } = require("express-validator");

// ─── Rate-limit strategy (per nexnote-ratelimit-fix.md) ───────────────────────
//   /register      — authLimiter      (strict: 50 failed / 15min, prod only)
//   /login         — authLimiter      (strict: 50 failed / 15min, prod only)
//   /refresh       — refreshLimiter   (relaxed: 200 / 15min — auto-fired by FE)
//   /change-passwd — passwordResetLimiter (5 / hour per IP)
//   /me /logout    — protected by globalLimiter at /api level
//
// All limiters are no-ops in development (NODE_ENV !== 'production') so local
// testing with multiple accounts on 127.0.0.1 never trips 429.
router.post("/register", authLimiter, sanitize, registerRules, validate, ctrl.register);
router.post("/login",    authLimiter, sanitize, loginRules,    validate, ctrl.login);
router.post("/refresh",
  refreshLimiter,
  [body("refreshToken").notEmpty().withMessage("Refresh token required"), validate],
  ctrl.refresh
);
router.post("/logout",  protect, ctrl.logout);
router.get("/me",       protect, ctrl.getMe);
router.patch("/me",     protect, sanitize,
  [body("name").optional().trim().isLength({ min: 2, max: 60 }), validate],
  ctrl.updateProfile
);
router.post("/change-password", protect, passwordResetLimiter, sanitize, changePasswordRules, validate, ctrl.changePassword);

module.exports = router;
