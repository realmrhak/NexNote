const svc = require("../services/todoService");
const { sendSuccess, sendCreated, sendNoContent } = require("../utils/apiResponse");

async function getTodos(req, res, next) {
  try {
    const { todos, meta } = await svc.getTodos(req.user._id, req.query);
    return sendSuccess(res, todos, "OK", 200, meta);
  } catch (err) { next(err); }
}

async function getTodoStats(req, res, next) {
  try {
    const teamId = req.query.teamId || null;
    return sendSuccess(res, await svc.getTodoStats(req.user._id, teamId));
  } catch (err) { next(err); }
}

async function getTodoById(req, res, next) {
  try { return sendSuccess(res, await svc.getTodoById(req.params.id, req.user._id)); }
  catch (err) { next(err); }
}

async function createTodo(req, res, next) {
  try { return sendCreated(res, await svc.createTodo(req.user._id, req.body), "Todo created."); }
  catch (err) { next(err); }
}

async function updateTodo(req, res, next) {
  try { return sendSuccess(res, await svc.updateTodo(req.params.id, req.user._id, req.body), "Todo updated."); }
  catch (err) { next(err); }
}

async function deleteTodo(req, res, next) {
  try { await svc.deleteTodo(req.params.id, req.user._id); return sendNoContent(res); }
  catch (err) { next(err); }
}

async function toggleTodo(req, res, next) {
  try {
    const todo = await svc.toggleTodo(req.params.id, req.user._id);
    return sendSuccess(res, todo, todo.isDone ? "Marked as done ✓" : "Marked as pending");
  } catch (err) { next(err); }
}

module.exports = { getTodos, getTodoStats, getTodoById, createTodo, updateTodo, deleteTodo, toggleTodo };
