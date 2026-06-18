const mongoose = require("mongoose");

const folderSchema = new mongoose.Schema(
  {
    name: {
      type:      String,
      required:  [true, "Folder name is required"],
      trim:      true,
      minlength: [1,  "Folder name cannot be empty"],
      maxlength: [60, "Folder name must be at most 60 characters"],
    },
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: "User",   required: true }, // index declared via schema.index below
    teamId:     { type: mongoose.Schema.Types.ObjectId, ref: "Team",   default: null  }, // null = personal
    color:      { type: String, default: null },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

folderSchema.index({ userId: 1 });
folderSchema.index({ userId: 1, createdAt: -1 });
folderSchema.index({ teamId: 1 });

const Folder = mongoose.model("Folder", folderSchema);
module.exports = Folder;
