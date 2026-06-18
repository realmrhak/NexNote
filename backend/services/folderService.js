const Folder = require("../models/Folder");
const Note   = require("../models/Note");
const Team   = require("../models/Team");
const User   = require("../models/User");
const mongoose = require("mongoose");
const { logAction } = require("./activityLogService");

function notFound() { const e = new Error("Folder not found."); e.statusCode = 404; return e; }
function forbidden(){ const e = new Error("Access denied.");     e.statusCode = 403; return e; }

async function findOwnFolder(folderId, userId) {
  const folder = await Folder.findById(folderId);
  if (!folder) throw notFound();
  // FIX: Allow team members to access team folders, not just the creator
  if (folder.teamId) {
    const team = await Team.findById(folder.teamId);
    if (team && (team.isMember(userId) || team.ownerId.equals(userId))) return folder;
  }
  if (!folder.userId.equals(userId)) throw forbidden();
  return folder;
}

async function getFolders(userId, teamId = null) {
  const filter = teamId ? { teamId } : { userId, teamId: null, isArchived: false };
  const folders = await Folder.find(filter).sort({ createdAt: 1 }).lean();

  // BUG #2 FIX: Aggregation pipelines do NOT auto-cast string IDs to
  // ObjectId (unlike normal Mongoose find/findOne queries). The previous
  // implementation passed `teamId` (a string from req.query) and `userId`
  // (an ObjectId from req.user._id) straight into `$match`. Mongoose *does*
  // coerce ObjectId fields in aggregation when the value is a string of
  // 24 hex chars for some versions, but this is inconsistent across
  // Mongoose/MongoDB versions and was empirically returning 0 for team
  // folders (the bug report: "Kisi bhi folder ke andar kitne notes hain
  // woh show nahi hota — hamesha '0 notes' dikhata hai.").
  //
  // The fix is to explicitly cast both `userId` and `teamId` to ObjectId
  // (or leave teamId as `null` for personal folders) before building the
  // match filter. We also expand the match so that team folders count ALL
  // notes in the team regardless of author, while personal folders only
  // count the requesting user's own notes.
  const userObjectId = new mongoose.Types.ObjectId(String(userId));
  const teamObjectId = teamId ? new mongoose.Types.ObjectId(String(teamId)) : null;

  const matchFilter = teamObjectId
    ? { isDeleted: false, teamId: teamObjectId, folderId: { $ne: null } }
    : { isDeleted: false, userId: userObjectId, teamId: null, folderId: { $ne: null } };

  const counts = await Note.aggregate([
    { $match: matchFilter },
    { $group: { _id: "$folderId", count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [c._id.toString(), c.count]));

  return folders.map((f) => ({ ...f, id: f._id, noteCount: countMap[f._id.toString()] || 0 }));
}

async function getFolderById(folderId, userId) {
  return findOwnFolder(folderId, userId);
}

async function createFolder(userId, data) {
  let actorName = "";
  // If creating a team folder, verify membership
  if (data.teamId) {
    const team = await Team.findById(data.teamId);
    if (!team || (!team.isMember(userId) && !team.ownerId.equals(userId))) {
      const e = new Error("Not a team member."); e.statusCode = 403; throw e;
    }
    try {
      const actor = await User.findById(userId).select("name").lean();
      actorName = actor?.name || "";
    } catch { /* best-effort */ }
  }
  const folder = await Folder.create({ ...data, userId });

  if (folder.teamId) {
    await logAction({
      teamId: folder.teamId,
      actorId: userId,
      actorName,
      action: "folder.create",
      description: `created folder “${folder.name}”`,
      targetType: "folder",
      targetId: folder._id,
      targetName: folder.name,
    }).catch(() => {});
  }

  return folder;
}

async function updateFolder(folderId, userId, updates) {
  const folder = await findOwnFolder(folderId, userId);
  Object.assign(folder, updates);
  await folder.save();
  return folder;
}

async function deleteFolder(folderId, userId) {
  const folder = await findOwnFolder(folderId, userId);
  // FIX: Only the folder creator or team admin can delete a team folder
  if (folder.teamId) {
    const team = await Team.findById(folder.teamId);
    if (!folder.userId.equals(userId) && !(team && team.isAdmin(userId))) {
      throw forbidden();
    }
  }
  const teamId = folder.teamId;
  const folderName = folder.name;
  await Note.updateMany({ folderId }, { $set: { folderId: null } });
  await Folder.findByIdAndDelete(folderId);

  if (teamId) {
    await logAction({
      teamId,
      actorId: userId,
      action: "folder.delete",
      description: `deleted folder “${folderName}”`,
      targetType: "folder",
      targetId: folderId,
      targetName: folderName,
    }).catch(() => {});
  }
}

module.exports = { getFolders, getFolderById, createFolder, updateFolder, deleteFolder };
