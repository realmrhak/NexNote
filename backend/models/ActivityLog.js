const mongoose = require("mongoose");

/**
 * ActivityLog
 * ─────────────────────────────────────────────────────────────────────────────
 * Records every meaningful action that happens inside a Team so the team
 * admin (and the original actor) can audit who did what and when.
 *
 * Visibility rules (enforced in the service layer):
 *   - Team admins/owner can see EVERY log entry for the team.
 *   - Non-admin members can only see log entries where they are the actor.
 *
 * Each log entry captures enough denormalised information (actorName,
 * targetName) to render the activity feed without extra joins.
 */
const activityLogSchema = new mongoose.Schema(
  {
    teamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: true,
      index: true,
    },

    // Who performed the action
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    actorName: { type: String, default: "" }, // denormalised for display

    // What kind of action — e.g. "note.create", "note.update", "todo.toggle",
    // "member.invite", "member.join", "member.remove", "member.role", "folder.create"
    action: {
      type: String,
      required: true,
      enum: [
        "note.create",
        "note.update",
        "note.delete",
        "note.pin",
        "note.unpin",
        "note.share",
        "note.unshare",
        "todo.create",
        "todo.update",
        "todo.toggle",
        "todo.delete",
        "folder.create",
        "folder.delete",
        "member.invite",
        "member.join",
        "member.remove",
        "member.role",
      ],
    },

    // Human-readable summary, e.g. "created note 'Sprint Plan'"
    description: { type: String, default: "", maxlength: 500 },

    // What was affected — type + id + denormalised name/title
    targetType: {
      type: String,
      enum: ["note", "todo", "folder", "member", "team", null],
      default: null,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    targetName: { type: String, default: "" },

    // Optional extra context (e.g. role assigned, todo isDone value)
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Index for the admin feed: most recent first within a team
activityLogSchema.index({ teamId: 1, createdAt: -1 });
// Index for "show only my logs" queries (non-admin view)
activityLogSchema.index({ teamId: 1, actorId: 1, createdAt: -1 });

// TTL: auto-delete logs after 1 year to keep the collection bounded
activityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });

const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);
module.exports = ActivityLog;
