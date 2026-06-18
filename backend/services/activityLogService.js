const mongoose = require("mongoose");
const ActivityLog = require("../models/ActivityLog");
const Team = require("../models/Team");
const User = require("../models/User");

function forbidden(msg = "Access denied.") { const e = new Error(msg); e.statusCode = 403; return e; }
function notFound(msg = "Team not found.") { const e = new Error(msg); e.statusCode = 404; return e; }

// REAL-TIME FIX: Lazy accessor for the Socket.io instance so we can broadcast
// a `log:created` event to the team room whenever a new activity log is
// written. Lazy-require avoids the circular import
// (app.js → routes → controllers → services → app.js).
function getIo() {
  try {
    return require("../app").get("io");
  } catch {
    return null;
  }
}

// Broadcast a newly-created log entry to every member of the team currently
// online (subscribed to the team room). Frontend listeners invalidate the
// ["team", teamId, "logs"] React Query cache so the Logs tab refreshes
// instantly — no manual reload required.
function broadcastLogCreated(teamId, logEntry) {
  const io = getIo();
  if (!io || !teamId || !logEntry) return;
  io.to(`team:${teamId}`).emit("log:created", {
    teamId: teamId.toString(),
    log: {
      _id: logEntry._id?.toString?.() || logEntry._id,
      action: logEntry.action,
      description: logEntry.description,
      actorName: logEntry.actorName,
      targetType: logEntry.targetType,
      targetName: logEntry.targetName,
      createdAt: logEntry.createdAt || new Date(),
    },
  });
}

/**
 * logAction — fire-and-forget helper used across services.
 *
 * Accepts either an actorId (ObjectId/string) or a populated actor object.
 * Resolves the actor's name from the User collection when only an id is
 * provided so the log entry stays readable even after the user is renamed
 * or deleted.
 *
 * Returns a Promise (callers may `await` it for ordering guarantees, or
 * `.catch()` it to swallow errors silently).
 *
 * REAL-TIME: After persisting the log, emits a `log:created` socket event
 * to the team room so every online member's Logs tab refreshes instantly.
 */
async function logAction({
  teamId,
  actorId,
  actorName = "",
  action,
  description = "",
  targetType = null,
  targetId = null,
  targetName = "",
  metadata = {},
}) {
  if (!teamId || !actorId || !action) return null;

  // Resolve actor name if not provided
  if (!actorName) {
    try {
      const actor = await User.findById(actorId).select("name").lean();
      actorName = actor?.name || "Unknown user";
    } catch { /* swallow — best-effort */ }
  }

  // Cast targetId to ObjectId if it's a non-null string
  let targetIdObj = null;
  if (targetId) {
    try { targetIdObj = new mongoose.Types.ObjectId(String(targetId)); } catch { /* ignore invalid */ }
  }

  const entry = await ActivityLog.create({
    teamId: new mongoose.Types.ObjectId(String(teamId)),
    actorId: new mongoose.Types.ObjectId(String(actorId)),
    actorName,
    action,
    description,
    targetType,
    targetId: targetIdObj,
    targetName,
    metadata,
  });

  // REAL-TIME FIX: Notify all team members a new log was just created so
  // their Logs tab refreshes instantly without a manual page reload.
  broadcastLogCreated(teamId, entry);

  return entry;
}

/**
 * getTeamLogs — return activity logs for a team.
 *
 * Visibility:
 *   - Admins/owner see ALL log entries.
 *   - Non-admin members see ONLY their own entries (where actorId === userId).
 *
 * The "Logs" tab in the UI is admin-only per the product spec, but the
 * backend still enforces per-entry visibility in case the endpoint is hit
 * directly by a non-admin.
 */
async function getTeamLogs(teamId, userId, { page = 1, limit = 100 } = {}) {
  const team = await Team.findById(teamId);
  if (!team) throw notFound();
  if (!team.isMember(userId) && !team.ownerId.equals(userId))
    throw forbidden("You are not a member of this team.");

  const isAdmin = team.isAdmin(userId);

  const filter = { teamId: new mongoose.Types.ObjectId(String(teamId)) };
  if (!isAdmin) {
    // Non-admins only see their own actions
    filter.actorId = new mongoose.Types.ObjectId(String(userId));
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [total, logs] = await Promise.all([
    ActivityLog.countDocuments(filter),
    ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean(),
  ]);

  return {
    logs,
    meta: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
      isAdmin, // useful for the frontend to know if the user is seeing all logs
    },
  };
}

module.exports = { logAction, getTeamLogs };
