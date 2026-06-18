const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

// ─── Member sub-schema ────────────────────────────────────────────────────────
const memberSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role:   {
      type:    String,
      enum:    ["owner", "admin", "member"],
      default: "member",
    },
    joinedAt: { type: Date, default: Date.now },
    // FIX #3 (v2): Per-member `status` field (Active/Inactive/Suspended)
    // has been REMOVED per product decision. Only `role` (owner/admin/member)
    // is now used to describe a member's standing inside a team.
  },
  { _id: false }
);

// ─── Pending invite sub-schema ────────────────────────────────────────────────
const inviteSchema = new mongoose.Schema(
  {
    email:     { type: String, required: true, lowercase: true, trim: true },
    token:     { type: String, default: () => uuidv4() },
    role:      { type: String, enum: ["admin", "member"], default: "member" },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    expiresAt: { type: Date,   default: () => new Date(Date.now() + 7 * 24 * 3600 * 1000) },
    accepted:  { type: Boolean, default: false },
  },
  { _id: false }
);

// ─── Team schema ──────────────────────────────────────────────────────────────
const teamSchema = new mongoose.Schema(
  {
    name: {
      type:      String,
      required:  [true, "Team name is required"],
      trim:      true,
      minlength: [2,  "Team name must be at least 2 characters"],
      maxlength: [60, "Team name must be at most 60 characters"],
    },

    description: { type: String, default: "", maxlength: 300 },

    // The user who created the team
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    members: [memberSchema],

    pendingInvites: [inviteSchema],

    // Optional team avatar / colour
    avatar: { type: String, default: null },
    color:  { type: String, default: "#2383E2" },

    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
teamSchema.index({ "members.userId": 1 });
teamSchema.index({ ownerId: 1 });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * isMember — check if a userId is a member (or owner)
 */
teamSchema.methods.isMember = function (userId) {
  return this.members.some((m) => m.userId.equals(userId));
};

/**
 * isAdmin — check if userId has admin or owner role
 */
teamSchema.methods.isAdmin = function (userId) {
  if (this.ownerId.equals(userId)) return true;
  const m = this.members.find((m) => m.userId.equals(userId));
  return m && (m.role === "admin" || m.role === "owner");
};

/**
 * getMemberRole
 */
teamSchema.methods.getMemberRole = function (userId) {
  if (this.ownerId.equals(userId)) return "owner";
  const m = this.members.find((m) => m.userId.equals(userId));
  return m ? m.role : null;
};

const Team = mongoose.model("Team", teamSchema);
module.exports = Team;
