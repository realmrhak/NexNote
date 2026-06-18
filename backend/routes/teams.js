const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/teamController");
const activityLogCtrl = require("../controllers/activityLogController");
const { protect }                             = require("../middleware/auth");
const { requireTeamMember, requireTeamAdmin } = require("../middleware/teamAuth");
const { validate, sanitize, teamRules, inviteRules, mongoIdParam } = require("../middleware/validators");
const { inviteLimiter } = require("../middleware/rateLimiter");
const { body, query } = require("express-validator");

router.use(protect);

// My teams
router.get("/",  ctrl.getMyTeams);
router.post("/", sanitize, teamRules, validate, ctrl.createTeam);

// Accept invite — any authenticated user (no team middleware needed yet)
router.post("/invites/:token/accept", ctrl.acceptInvite);

// Single team routes
router.get("/:teamId",    mongoIdParam("teamId"), validate, requireTeamMember, ctrl.getTeamById);
router.patch("/:teamId",  mongoIdParam("teamId"), validate, requireTeamAdmin, sanitize, teamRules, validate, ctrl.updateTeam);
router.delete("/:teamId", mongoIdParam("teamId"), validate, requireTeamAdmin, ctrl.deleteTeam);
router.get("/:teamId/stats", mongoIdParam("teamId"), validate, requireTeamMember, ctrl.getTeamStats);

// Activity logs — visible to admins (all logs) and to non-admin members for
// their own actions. The requireTeamMember middleware ensures the requester
// belongs to the team; finer-grained per-entry visibility is enforced in the
// service layer.
router.get("/:teamId/logs",
  mongoIdParam("teamId"),
  validate,
  requireTeamMember,
  [
    query("page").optional().isInt({ min: 1 }).withMessage("page must be a positive integer"),
    query("limit").optional().isInt({ min: 1, max: 500 }).withMessage("limit must be 1–500"),
    validate,
  ],
  activityLogCtrl.getTeamLogs
);

// Invites — with rate limiter
router.post("/:teamId/invites",
  mongoIdParam("teamId"), validate, requireTeamAdmin, inviteLimiter, sanitize, inviteRules, validate, ctrl.inviteMember
);
router.delete("/:teamId/invites",
  mongoIdParam("teamId"), validate, requireTeamAdmin,
  [body("email").isEmail().withMessage("Valid email required"), validate],
  ctrl.cancelInvite
);

// Members
router.delete("/:teamId/members/:userId",
  mongoIdParam("teamId"), mongoIdParam("userId"), validate, requireTeamMember, ctrl.removeMember
);
router.patch("/:teamId/members/:userId/role",
  mongoIdParam("teamId"), mongoIdParam("userId"), validate, requireTeamAdmin,
  [body("role").isIn(["admin", "member"]).withMessage("Role must be admin or member"), validate],
  ctrl.updateMemberRole
);
// COMBINED FIX #3: Member status update — admin-only, real-time broadcast.
// FIX #3 (v2): Route removed — member status field no longer exists in the
// schema. Only role (owner/admin/member) is used now.

module.exports = router;
