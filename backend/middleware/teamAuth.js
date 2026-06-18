const Team      = require("../models/Team");
const { sendError } = require("../utils/apiResponse");

/**
 * requireTeamMember
 * Checks that req.user is a member of the team in req.params.teamId.
 * Attaches req.team for use in controllers/services.
 */
async function requireTeamMember(req, res, next) {
  try {
    const team = await Team.findById(req.params.teamId);
    if (!team || team.isArchived)
      return sendError(res, "Team not found.", 404);

    if (!team.isMember(req.user._id) && !team.ownerId.equals(req.user._id))
      return sendError(res, "You are not a member of this team.", 403);

    req.team = team;
    next();
  } catch (err) { next(err); }
}

/**
 * requireTeamAdmin
 * Same as requireTeamMember but also enforces admin/owner role.
 */
async function requireTeamAdmin(req, res, next) {
  try {
    const team = await Team.findById(req.params.teamId);
    if (!team || team.isArchived)
      return sendError(res, "Team not found.", 404);

    if (!team.isAdmin(req.user._id))
      return sendError(res, "Team admin access required.", 403);

    req.team = team;
    next();
  } catch (err) { next(err); }
}

module.exports = { requireTeamMember, requireTeamAdmin };
