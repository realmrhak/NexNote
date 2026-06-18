const svc = require("../services/teamService");
const { sendSuccess, sendCreated, sendNoContent } = require("../utils/apiResponse");

async function getMyTeams(req, res, next) {
  try { return sendSuccess(res, await svc.getMyTeams(req.user._id)); }
  catch (err) { next(err); }
}

async function getTeamById(req, res, next) {
  try { return sendSuccess(res, await svc.getTeamById(req.params.teamId)); }
  catch (err) { next(err); }
}

async function createTeam(req, res, next) {
  try { return sendCreated(res, await svc.createTeam(req.user._id, req.body), "Team created."); }
  catch (err) { next(err); }
}

async function updateTeam(req, res, next) {
  try { return sendSuccess(res, await svc.updateTeam(req.params.teamId, req.user._id, req.body), "Team updated."); }
  catch (err) { next(err); }
}

async function deleteTeam(req, res, next) {
  try { await svc.deleteTeam(req.params.teamId, req.user._id); return sendNoContent(res); }
  catch (err) { next(err); }
}

async function inviteMember(req, res, next) {
  try {
    const result = await svc.inviteMember(req.team, req.user._id, req.body);
    return sendSuccess(res, result, "Invitation sent.");
  } catch (err) { next(err); }
}

async function acceptInvite(req, res, next) {
  try {
    const team = await svc.acceptInvite(req.params.token, req.user._id);
    return sendSuccess(res, team, "You have joined the team!");
  } catch (err) { next(err); }
}

async function removeMember(req, res, next) {
  try {
    await svc.removeMember(req.params.teamId, req.user._id, req.params.userId);
    return sendNoContent(res);
  } catch (err) { next(err); }
}

async function updateMemberRole(req, res, next) {
  try {
    const team = await svc.updateMemberRole(req.params.teamId, req.user._id, req.params.userId, req.body.role);
    return sendSuccess(res, team, "Role updated.");
  } catch (err) { next(err); }
}

// COMBINED FIX #3: Update a member's status (active/inactive/suspended).
// FIX #3 (v2): Removed — member status field no longer exists in the schema.
// Only role (owner/admin/member) is used to describe a member's standing.

async function cancelInvite(req, res, next) {
  try {
    await svc.cancelInvite(req.params.teamId, req.user._id, req.body.email);
    return sendNoContent(res);
  } catch (err) { next(err); }
}

async function getTeamStats(req, res, next) {
  try { return sendSuccess(res, await svc.getTeamStats(req.params.teamId)); }
  catch (err) { next(err); }
}

module.exports = { getMyTeams, getTeamById, createTeam, updateTeam, deleteTeam, inviteMember, acceptInvite, removeMember, updateMemberRole, cancelInvite, getTeamStats };
