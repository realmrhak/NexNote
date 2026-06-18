const { validationResult, body, param, query } = require("express-validator");
const { sendError } = require("../utils/apiResponse");

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formatted = errors.array().map((e) => ({ field: e.path, message: e.msg }));
    return sendError(res, "Validation failed", 422, formatted);
  }
  next();
}

// ─── XSS Sanitization ──────────────────────────────────────────────────────────
/**
 * stripTags — Simple regex-based HTML tag stripping (DOMPurify-like for server).
 * Removes anything that looks like an HTML tag from string fields.
 */
function stripTags(str) {
  if (typeof str !== "string") return str;
  return str.replace(/<[^>]*>/g, "");
}

/**
 * sanitize — Middleware that strips HTML tags from all string fields in req.body.
 * Runs recursively through nested objects. Skips arrays of non-strings (e.g. tags).
 */
function sanitize(req, res, next) {
  function clean(obj) {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === "string") {
        obj[key] = stripTags(obj[key]);
      } else if (typeof obj[key] === "object" && obj[key] !== null && !Array.isArray(obj[key])) {
        clean(obj[key]);
      }
    }
  }
  if (req.body) clean(req.body);
  next();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
// SECURITY FIX: Bumped minimum password length to 8 and added a complexity
// rule (must contain at least one letter + one number). 6-char passwords
// were too easy to brute-force. Existing users keep their passwords — this
// only affects NEW registrations and password CHANGES.
const registerRules = [
  body("name").trim().notEmpty().withMessage("Name is required")
    .isLength({ min: 2, max: 60 }).withMessage("Name must be 2–60 characters"),
  body("email").trim().notEmpty().withMessage("Email is required")
    .isEmail().withMessage("Invalid email").normalizeEmail(),
  body("password").notEmpty().withMessage("Password is required")
    .isLength({ min: 8 }).withMessage("Password must be at least 8 characters")
    .matches(/[A-Za-z]/).withMessage("Password must contain at least one letter")
    .matches(/[0-9]/).withMessage("Password must contain at least one number"),
];

const loginRules = [
  body("email").trim().notEmpty().withMessage("Email is required")
    .isEmail().withMessage("Invalid email").normalizeEmail(),
  body("password").notEmpty().withMessage("Password is required"),
];

const changePasswordRules = [
  body("currentPassword").notEmpty().withMessage("Current password is required"),
  body("newPassword").notEmpty().withMessage("New password is required")
    .isLength({ min: 8 }).withMessage("New password must be at least 8 characters")
    .matches(/[A-Za-z]/).withMessage("New password must contain at least one letter")
    .matches(/[0-9]/).withMessage("New password must contain at least one number"),
  body("confirmPassword").notEmpty().withMessage("Password confirmation is required")
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error("Passwords do not match");
      }
      return true;
    }),
];

// ─── Notes ────────────────────────────────────────────────────────────────────
const noteRules = [
  body("title").optional().trim().isLength({ max: 300 }).withMessage("Title too long"),
  body("body").optional().isString().isLength({ max: 100000 }).withMessage("Note body exceeds maximum length of 100000 characters"),
  body("tags").optional().isArray({ max: 20 }).withMessage("Max 20 tags"),
  body("folderId").optional({ nullable: true }).isMongoId().withMessage("Invalid folderId"),
  body("isPinned").optional().isBoolean(),
  body("isShared").optional().isBoolean(),
  body("teamId").optional({ nullable: true }).isMongoId().withMessage("Invalid teamId"),
];

const noteQueryRules = [
  query("page").optional().isInt({ min: 1 }).withMessage("page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("limit must be 1–100"),
  // FIX: folderId can be "null" (string) for filtering uncategorized notes, or a MongoId
  query("folderId").optional({ nullable: true }).custom((value) => {
    if (value === "null" || value === null) return true;
    if (/^[0-9a-fA-F]{24}$/.test(value)) return true;
    throw new Error("Invalid folderId");
  }),
  query("teamId").optional({ nullable: true }).isMongoId().withMessage("Invalid teamId"),
  query("tag").optional().isString(),
  // FIX: query params are strings — use isIn instead of isBoolean
  query("pinned").optional().isIn(["true", "false"]).withMessage("pinned must be true or false"),
  query("q").optional().isString().isLength({ max: 200 }),
  query("sort").optional().isIn(["updatedAt", "createdAt", "title"]),
  query("order").optional().isIn(["asc", "desc"]),
];

// ─── Folders ──────────────────────────────────────────────────────────────────
const folderRules = [
  body("name").trim().notEmpty().withMessage("Folder name is required")
    .isLength({ min: 1, max: 100 }).withMessage("Folder name must be 1–100 characters"),
  body("color").optional({ nullable: true })
    .matches(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/).withMessage("Invalid hex color"),
  body("teamId").optional({ nullable: true }).isMongoId().withMessage("Invalid teamId"),
];

const folderUpdateRules = [
  body("name").optional().trim().isLength({ min: 1, max: 100 }).withMessage("Folder name must be 1–100 characters"),
  body("color").optional({ nullable: true })
    .matches(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/).withMessage("Invalid hex color"),
];

// ─── Teams ────────────────────────────────────────────────────────────────────
const teamRules = [
  body("name").trim().notEmpty().withMessage("Team name is required")
    .isLength({ min: 2, max: 60 }),
  body("description").optional().isLength({ max: 300 }),
  body("color").optional({ nullable: true })
    .matches(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/).withMessage("Invalid hex color"),
];

const inviteRules = [
  body("email").trim().notEmpty().withMessage("Email is required")
    .isEmail().withMessage("Invalid email").normalizeEmail(),
  body("role").optional().isIn(["admin", "member"]).withMessage("Role must be admin or member"),
];

// ─── Todos ────────────────────────────────────────────────────────────────────
const todoRules = [
  body("title").trim().notEmpty().withMessage("Title is required").isLength({ max: 300 }),
  body("description").optional().isLength({ max: 1000 }),
  body("priority").optional().isIn(["low", "medium", "high"]),
  body("dueDate").optional({ nullable: true }).isISO8601().withMessage("Invalid date"),
  body("teamId").optional({ nullable: true }).isMongoId(),
  body("noteId").optional({ nullable: true }).isMongoId(),
  body("assignedTo").optional({ nullable: true }).isMongoId(),
  body("tags").optional().isArray(),
];

const todoUpdateRules = [
  body("title").optional().trim().isLength({ max: 300 }),
  body("description").optional().isLength({ max: 1000 }),
  body("priority").optional().isIn(["low", "medium", "high"]),
  body("dueDate").optional({ nullable: true }).isISO8601(),
  body("assignedTo").optional({ nullable: true }).isMongoId(),
  body("tags").optional().isArray(),
  body("isDone").optional().isBoolean(),
  body("position").optional().isInt({ min: 0 }),
];

// ─── Params ───────────────────────────────────────────────────────────────────
// FIX: return as array so it works consistently whether spread or used alone in routes
const mongoIdParam = (name) => [
  param(name).isMongoId().withMessage(`Invalid ${name}`),
];

module.exports = {
  validate,
  sanitize,
  registerRules, loginRules, changePasswordRules,
  noteRules, noteQueryRules,
  folderRules, folderUpdateRules,
  teamRules, inviteRules,
  todoRules, todoUpdateRules,
  mongoIdParam,
};
