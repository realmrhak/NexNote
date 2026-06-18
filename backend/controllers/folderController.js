const svc = require("../services/folderService");
const { sendSuccess, sendCreated, sendNoContent } = require("../utils/apiResponse");

async function getFolders(req, res, next) {
  try {
    const teamId  = req.query.teamId || null;
    return sendSuccess(res, await svc.getFolders(req.user._id, teamId));
  } catch (err) { next(err); }
}

async function getFolderById(req, res, next) {
  try { return sendSuccess(res, await svc.getFolderById(req.params.id, req.user._id)); }
  catch (err) { next(err); }
}

async function createFolder(req, res, next) {
  try { return sendCreated(res, await svc.createFolder(req.user._id, req.body), "Folder created."); }
  catch (err) { next(err); }
}

async function updateFolder(req, res, next) {
  try { return sendSuccess(res, await svc.updateFolder(req.params.id, req.user._id, req.body), "Folder updated."); }
  catch (err) { next(err); }
}

async function deleteFolder(req, res, next) {
  try { await svc.deleteFolder(req.params.id, req.user._id); return sendNoContent(res); }
  catch (err) { next(err); }
}

module.exports = { getFolders, getFolderById, createFolder, updateFolder, deleteFolder };
