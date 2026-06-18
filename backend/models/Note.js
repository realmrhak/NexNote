const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const noteSchema = new mongoose.Schema(
  {
    title:    { type: String, default: "", trim: true, maxlength: [300, "Title too long"] },
    body:     { type: String, default: "" },
    tags:     {
      type:     [String],
      default:  [],
      validate: { validator: (a) => a.length <= 20, message: "Max 20 tags" },
    },

    userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User",   required: true },
    folderId: { type: mongoose.Schema.Types.ObjectId, ref: "Folder", default: null  },

    // Team note — null means it's a personal note
    teamId:   { type: mongoose.Schema.Types.ObjectId, ref: "Team",   default: null  },

    isPinned:  { type: Boolean, default: false },
    isShared:  { type: Boolean, default: false },

    // BUG 1 FIX: Use partialFilterExpression instead of `sparse: true`.
    //
    // HISTORY
    // ========
    // The original schema used `{ unique: true }` (no sparse, no partial
    // filter). Because notes that are NOT shared still wrote
    // `shareToken: null` into the document (the schema default), EVERY
    // non-shared note ended up in the index with key `shareToken: null`.
    // The second non-shared note then collided with the first →
    // E11000 duplicate key error → note creation was completely broken.
    //
    // WHY partialFilterExpression (not sparse: true)
    // ==============================================
    // A sparse unique index skips documents where the field is MISSING, but
    // still indexes documents where the field is PRESENT-AND-NULL. Because
    // Mongoose saves the `default: null` into the document, every saved note
    // had `shareToken: null` in the document, which collided on the sparse
    // unique index. `partialFilterExpression: { shareToken: { $type: "string" } }`
    // only indexes documents where shareToken is actually a string, so null
    // AND missing values are both excluded from the unique constraint.
    //
    // ROBUSTNESS
    // ==========
    // The backend also runs an `ensureNotesIndexes()` function on startup
    // (see backend/config/db.js) that drops ALL legacy shareToken indexes
    // and explicitly recreates the correct partial-filter unique index, so
    // even databases that still have the old index from a previous version
    // are repaired automatically before the server starts listening.
    shareToken: {
      type: String,
      default: null,
      index: {
        unique: true,
        partialFilterExpression: { shareToken: { $type: "string" } },
      },
    },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date,    default: null  },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// ─── Compound indexes (no duplicates) ────────────────────────────────────────
noteSchema.index({ userId: 1, updatedAt: -1 });
noteSchema.index({ userId: 1, folderId: 1  });
noteSchema.index({ userId: 1, isPinned: 1  });
noteSchema.index({ userId: 1, tags: 1      });
noteSchema.index({ teamId: 1, updatedAt: -1 });
noteSchema.index({ title: "text", body: "text" }, { weights: { title: 2, body: 1 } });

// ─── Auto-generate shareToken ─────────────────────────────────────────────────
// When a note is shared, generate a UUID shareToken. When a note is un-shared,
// $unset the field so the document has no shareToken at all (instead of
// `shareToken: null`). This keeps the document clean and works perfectly with
// the partialFilterExpression index (which excludes both null and missing).
noteSchema.pre("save", function (next) {
  if (this.isShared && !this.shareToken) this.shareToken = uuidv4();
  if (!this.isShared && this.shareToken) {
    // `this.set(..., undefined)` marks the field for $unset on save —
    // the document then has no shareToken field at all, which the
    // partialFilterExpression index also excludes.
    this.set("shareToken", undefined);
  }
  next();
});

// ─── Soft delete ──────────────────────────────────────────────────────────────
noteSchema.methods.softDelete = async function () {
  this.isDeleted = true;
  this.deletedAt = new Date();
  return this.save();
};

// ─── Default query: exclude deleted ──────────────────────────────────────────
noteSchema.pre(/^find/, function (next) {
  if (!this.getOptions().withDeleted) this.where({ isDeleted: false });
  next();
});

const Note = mongoose.model("Note", noteSchema);
module.exports = Note;
