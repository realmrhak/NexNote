const mongoose = require("mongoose");
const Note   = require("../models/Note");
const Folder = require("../models/Folder");
const Team   = require("../models/Team");
const User   = require("../models/User");
const { logAction } = require("./activityLogService");

const MAX_PINNED = 10;

function notFound(msg = "Note not found.")  { const e = new Error(msg); e.statusCode = 404; return e; }
function forbidden(msg = "Access denied.")  { const e = new Error(msg); e.statusCode = 403; return e; }

// BUG #3 FIX: Lazy accessor for the Socket.io instance so we can broadcast
// note changes to team members in real time. The Express app sets
// `app.set("io", io)` on startup (see server.js).
function getIo() {
  try {
    return require("../app").get("io");
  } catch {
    return null;
  }
}

// Broadcast a note list change to all team members so list views refresh.
function broadcastNoteListChange(teamId, action, noteId) {
  const io = getIo();
  if (!io || !teamId) return;
  io.to(`team:${teamId}`).emit("note:list:changed", {
    teamId: teamId.toString(),
    noteId: noteId ? noteId.toString() : null,
    action, // "create" | "update" | "delete"
  });
}

async function canAccessNote(note, userId) {
  // Own personal note
  if (note.userId.equals(userId)) return true;
  // Team note — check membership
  if (note.teamId) {
    const team = await Team.findById(note.teamId);
    if (team && !team.isArchived && (team.isMember(userId) || team.ownerId.equals(userId))) return true;
  }
  return false;
}

async function findAccessibleNote(noteId, userId) {
  const note = await Note.findById(noteId);
  if (!note) throw notFound();
  if (!(await canAccessNote(note, userId))) throw forbidden();
  return note;
}

async function getNotes(userId, query) {
  const { page = 1, limit = 20, folderId, tag, pinned, q, sort = "updatedAt", order = "desc", teamId } = query;

  let filter;
  if (teamId) {
    const team = await Team.findById(teamId);
    if (!team || team.isArchived || (!team.isMember(userId) && !team.ownerId.equals(userId)))
      throw forbidden("You are not a member of this team.");
    filter = { teamId: new mongoose.Types.ObjectId(teamId) };
    // BUG 3 FIX: When viewing a team's root (no specific folderId requested),
    // only return notes that are NOT inside a folder. Notes inside folders
    // should only appear when the user explicitly opens that folder.
    // Without this, every team note — including folder notes — would appear
    // in the team's root Notes tab, defeating the purpose of folders.
    if (folderId === undefined) {
      filter.folderId = null;
    }
  } else {
    // Strict personal — user's own notes with no team
    filter = { userId: new mongoose.Types.ObjectId(String(userId)), teamId: null };
  }

  // FIX: folderId comes as string from query params — "null" string means uncategorized
  if (folderId !== undefined) {
    filter.folderId = (folderId && folderId !== "null") ? new mongoose.Types.ObjectId(folderId) : null;
  }
  if (tag)                    filter.tags      = tag;
  // FIX: pinned comes as string from query
  if (pinned !== undefined)   filter.isPinned  = pinned === "true";

  let cursor;
  if (q) {
    cursor = Note.find({ ...filter, $text: { $search: q } }, { score: { $meta: "textScore" } })
      .sort({ score: { $meta: "textScore" }, updatedAt: -1 });
  } else {
    cursor = Note.find(filter).sort({ [sort]: order === "asc" ? 1 : -1 });
  }

  const skip  = (Number(page) - 1) * Number(limit);
  // PERF FIX: Run count and find in parallel instead of sequentially
  const [total, notes] = await Promise.all([
    Note.countDocuments(filter),
    cursor.skip(skip).limit(Number(limit)).populate("folderId", "name color").populate("userId", "name").lean(),
  ]);

  return {
    notes,
    meta: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
  };
}

async function getNoteById(noteId, userId) {
  const note = await Note.findById(noteId).populate("folderId", "name color");
  if (!note) throw notFound();
  if (!(await canAccessNote(note, userId))) throw forbidden();
  return note;
}

async function createNote(userId, data) {
  if (data.folderId) {
    const folder = await Folder.findById(data.folderId);
    if (!folder) { const e = new Error("Folder not found."); e.statusCode = 404; throw e; }
    if (data.teamId) {
      if (!folder.teamId || !folder.teamId.equals(data.teamId)) {
        const e = new Error("Folder does not belong to this team."); e.statusCode = 400; throw e;
      }
    } else {
      if (!folder.userId.equals(userId)) {
        const e = new Error("Folder does not belong to you."); e.statusCode = 403; throw e;
      }
    }
  }
  let actorName = "";
  if (data.teamId) {
    const team = await Team.findById(data.teamId);
    if (!team || team.isArchived || (!team.isMember(userId) && !team.ownerId.equals(userId))) {
      const e = new Error("You are not a member of this team."); e.statusCode = 403; throw e;
    }
    // Pre-fetch actor name for the activity log
    try {
      const actor = await User.findById(userId).select("name").lean();
      actorName = actor?.name || "";
    } catch { /* best-effort */ }
  }
  const note = await Note.create({ ...data, userId });

  // Activity log: only team notes are logged
  if (data.teamId) {
    await logAction({
      teamId: data.teamId,
      actorId: userId,
      actorName,
      action: "note.create",
      description: `created note “${note.title || "Untitled"}”`,
      targetType: "note",
      targetId: note._id,
      targetName: note.title || "Untitled",
      metadata: { folderId: note.folderId || null },
    }).catch(() => {});

    // BUG #3 FIX: Notify team members in real time that a new note was
    // created so the team notes list refreshes without polling.
    broadcastNoteListChange(note.teamId, "create", note._id);
  }

  return note;
}

async function updateNote(noteId, userId, updates) {
  const note = await findAccessibleNote(noteId, userId);
  // Allow edit if user is the author OR if it's a team note and user is a team member
  if (!note.userId.equals(userId)) {
    if (note.teamId) {
      const team = await Team.findById(note.teamId);
      if (!team || (!team.isMember(userId) && !team.ownerId.equals(userId)))
        throw forbidden("Only team members can edit team notes.");
    } else {
      throw forbidden("Only the note author can edit it.");
    }
  }
  // Don't allow changing ownership via update
  delete updates.userId;
  delete updates.teamId;
  // Validate folderId change — ensure the folder belongs to the same context (personal or team)
  if (updates.folderId !== undefined) {
    if (updates.folderId) {
      const folder = await Folder.findById(updates.folderId);
      if (!folder) { const e = new Error("Folder not found."); e.statusCode = 404; throw e; }
      // If the note is a team note, the folder must belong to the same team
      if (note.teamId && (!folder.teamId || !folder.teamId.equals(note.teamId))) {
        const e = new Error("Folder must belong to the same team."); e.statusCode = 400; throw e;
      }
      // If the note is personal, the folder must be personal too
      if (!note.teamId && folder.teamId) {
        const e = new Error("Cannot move a personal note to a team folder."); e.statusCode = 400; throw e;
      }
    }
  }
  const prevTitle = note.title || "Untitled";
  Object.assign(note, updates);
  await note.save();

  // Activity log: only for team notes
  if (note.teamId) {
    await logAction({
      teamId: note.teamId,
      actorId: userId,
      action: "note.update",
      description: `edited note “${note.title || prevTitle}”`,
      targetType: "note",
      targetId: note._id,
      targetName: note.title || prevTitle,
      metadata: { updatedFields: Object.keys(updates) },
    }).catch(() => {});

    // BUG #3 FIX: Broadcast the update to all OTHER editors currently in the
    // note room (so their editor reflects the change in real time) AND to the
    // team room (so team note lists refresh, e.g. updated timestamp).
    const io = getIo();
    if (io) {
      // Other editors currently viewing this note:
      io.to(`note:${note._id}`).emit("note:updated", {
        noteId: note._id.toString(),
        title: note.title,
        body: note.body,
        tags: note.tags,
        updatedAt: note.updatedAt,
        // We don't know the editor's name from here (REST caller), so we omit
        // updatedBy — the editor that emitted via socket provides it. The
        // frontend treats missing updatedBy as a silent refresh.
      });
      // Team members not currently in the editor:
      broadcastNoteListChange(note.teamId, "update", note._id);
    }
  }

  return note;
}

async function deleteNote(noteId, userId) {
  const note = await findAccessibleNote(noteId, userId);
  if (!note.userId.equals(userId)) {
    if (note.teamId) {
      const team = await Team.findById(note.teamId);
      if (!team || (!team.isMember(userId) && !team.ownerId.equals(userId)))
        throw forbidden("Only team members can delete team notes.");
    } else {
      throw forbidden("Only the note author can delete it.");
    }
  }
  const teamId = note.teamId;
  const noteTitle = note.title || "Untitled";
  await note.softDelete();

  if (teamId) {
    await logAction({
      teamId,
      actorId: userId,
      action: "note.delete",
      description: `deleted note “${noteTitle}”`,
      targetType: "note",
      targetId: note._id,
      targetName: noteTitle,
    }).catch(() => {});

    // BUG #3 FIX: Notify team members the note was deleted so lists refresh.
    const io = getIo();
    if (io) {
      // Kick any editors currently viewing this note so they get a clean
      // "note was deleted" message instead of confusing save failures.
      io.to(`note:${note._id}`).emit("note:deleted", {
        noteId: note._id.toString(),
        deletedBy: userId.toString(),
      });
      broadcastNoteListChange(teamId, "delete", note._id);
    }
  }
}

async function togglePin(noteId, userId) {
  const note = await findAccessibleNote(noteId, userId);
  if (!note.userId.equals(userId)) {
    if (note.teamId) {
      const team = await Team.findById(note.teamId);
      if (!team || (!team.isMember(userId) && !team.ownerId.equals(userId)))
        throw forbidden("Only team members can pin team notes.");
    } else {
      throw forbidden("Only the note author can pin it.");
    }
  }
  if (!note.isPinned) {
    const count = await Note.countDocuments({ userId, isPinned: true });
    if (count >= MAX_PINNED) {
      const e = new Error(`You can pin at most ${MAX_PINNED} notes.`); e.statusCode = 422; throw e;
    }
  }
  note.isPinned = !note.isPinned;
  await note.save();

  if (note.teamId) {
    await logAction({
      teamId: note.teamId,
      actorId: userId,
      action: note.isPinned ? "note.pin" : "note.unpin",
      description: `${note.isPinned ? "pinned" : "unpinned"} note "${note.title || "Untitled"}"`,
      targetType: "note",
      targetId: note._id,
      targetName: note.title || "Untitled",
    }).catch(() => {});
  }

  return note;
}

async function shareNote(noteId, userId) {
  const note = await findAccessibleNote(noteId, userId);
  if (!note.userId.equals(userId)) {
    if (note.teamId) {
      const team = await Team.findById(note.teamId);
      if (!team || (!team.isMember(userId) && !team.ownerId.equals(userId)))
        throw forbidden("Only team members can share team notes.");
    } else {
      throw forbidden("Only the note author can share it.");
    }
  }
  note.isShared = true;
  await note.save();

  if (note.teamId) {
    await logAction({
      teamId: note.teamId,
      actorId: userId,
      action: "note.share",
      description: `enabled sharing for note “${note.title || "Untitled"}”`,
      targetType: "note",
      targetId: note._id,
      targetName: note.title || "Untitled",
    }).catch(() => {});
  }

  return note;
}

async function unshareNote(noteId, userId) {
  const note = await findAccessibleNote(noteId, userId);
  if (!note.userId.equals(userId)) {
    if (note.teamId) {
      const team = await Team.findById(note.teamId);
      if (!team || (!team.isMember(userId) && !team.ownerId.equals(userId)))
        throw forbidden("Only team members can unshare team notes.");
    } else {
      throw forbidden("Only the note author can unshare it.");
    }
  }
  note.isShared = false;
  // BUG 1 FIX: unset shareToken instead of writing null. The pre-save hook
  // on the Note model would also handle this, but setting it explicitly here
  // (via `set(..., undefined)` which marks the field for $unset) makes the
  // intent clear and keeps the document clean.
  note.set("shareToken", undefined);
  await note.save();

  if (note.teamId) {
    await logAction({
      teamId: note.teamId,
      actorId: userId,
      action: "note.unshare",
      description: `disabled sharing for note “${note.title || "Untitled"}”`,
      targetType: "note",
      targetId: note._id,
      targetName: note.title || "Untitled",
    }).catch(() => {});
  }

  return note;
}

async function getNoteByShareToken(shareToken) {
  const note = await Note.findOne({ shareToken, isShared: true }).populate("folderId", "name").lean();
  if (!note) throw notFound("Shared note not found or access has been revoked.");
  return note;
}

// FIX: cast userId to ObjectId for aggregation pipeline
async function getAllTags(userId) {
  return Note.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(String(userId)), isDeleted: false, teamId: null } },
    { $unwind: "$tags" },
    { $group: { _id: "$tags", count: { $sum: 1 } } },
    { $sort:  { count: -1 } },
    { $project: { _id: 0, tag: "$_id", count: 1 } },
  ]);
}

module.exports = {
  getNotes, getNoteById, createNote, updateNote, deleteNote,
  togglePin, shareNote, unshareNote, getNoteByShareToken, getAllTags,
};
