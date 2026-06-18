const mongoose = require("mongoose");

const todoSchema = new mongoose.Schema(
  {
    title: {
      type:      String,
      required:  [true, "Todo title is required"],
      trim:      true,
      maxlength: [300, "Title too long"],
    },

    description: { type: String, default: "", maxlength: 1000 },

    isDone:    { type: Boolean, default: false },
    doneAt:    { type: Date,    default: null  },

    // Priority: low / medium / high
    priority: {
      type:    String,
      enum:    ["low", "medium", "high"],
      default: "medium",
    },

    dueDate: { type: Date, default: null },

    // Owner of this todo
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // If set — this is a team todo (visible to all team members)
    // If null — this is a personal todo (only visible to creator)
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },

    // Optional link to a note
    noteId: { type: mongoose.Schema.Types.ObjectId, ref: "Note", default: null },

    // Assigned to (for team todos)
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Ordering position within a list
    position: { type: Number, default: 0 },

    tags: { type: [String], default: [] },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
todoSchema.index({ userId: 1, isDone: 1, position: 1 });
todoSchema.index({ teamId: 1, isDone: 1, position: 1 });

// ─── Mark done helper ─────────────────────────────────────────────────────────
todoSchema.methods.markDone = async function () {
  this.isDone  = true;
  this.doneAt  = new Date();
  return this.save();
};

todoSchema.methods.markUndone = async function () {
  this.isDone = false;
  this.doneAt = null;
  return this.save();
};

const Todo = mongoose.model("Todo", todoSchema);
module.exports = Todo;
