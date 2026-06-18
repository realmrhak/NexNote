const svc = require("../services/noteService");
const { sendSuccess, sendCreated, sendNoContent } = require("../utils/apiResponse");

async function getNotes(req, res, next) {
  try {
    const { notes, meta } = await svc.getNotes(req.user._id, req.query);
    return sendSuccess(res, notes, "OK", 200, meta);
  } catch (err) { next(err); }
}

async function getTags(req, res, next) {
  try { return sendSuccess(res, await svc.getAllTags(req.user._id)); }
  catch (err) { next(err); }
}

async function getNoteById(req, res, next) {
  try { return sendSuccess(res, await svc.getNoteById(req.params.id, req.user._id)); }
  catch (err) { next(err); }
}

async function createNote(req, res, next) {
  try { return sendCreated(res, await svc.createNote(req.user._id, req.body), "Note created."); }
  catch (err) { next(err); }
}

async function updateNote(req, res, next) {
  try { return sendSuccess(res, await svc.updateNote(req.params.id, req.user._id, req.body), "Note updated."); }
  catch (err) { next(err); }
}

async function deleteNote(req, res, next) {
  try { await svc.deleteNote(req.params.id, req.user._id); return sendNoContent(res); }
  catch (err) { next(err); }
}

async function togglePin(req, res, next) {
  try {
    const note = await svc.togglePin(req.params.id, req.user._id);
    return sendSuccess(res, note, note.isPinned ? "Note pinned." : "Note unpinned.");
  } catch (err) { next(err); }
}

async function shareNote(req, res, next) {
  try {
    const note     = await svc.shareNote(req.params.id, req.user._id);
    const shareUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}?shared=${note.shareToken}`;
    return sendSuccess(res, { note, shareUrl }, "Sharing enabled.");
  } catch (err) { next(err); }
}

async function unshareNote(req, res, next) {
  try { return sendSuccess(res, await svc.unshareNote(req.params.id, req.user._id), "Sharing disabled."); }
  catch (err) { next(err); }
}

async function getSharedNote(req, res, next) {
  try { return sendSuccess(res, await svc.getNoteByShareToken(req.params.token)); }
  catch (err) { next(err); }
}

module.exports = { getNotes, getTags, getNoteById, createNote, updateNote, deleteNote, togglePin, shareNote, unshareNote, getSharedNote };
