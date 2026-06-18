const Todo = require("../models/Todo");
const Team = require("../models/Team");
const User = require("../models/User");
const { logAction } = require("./activityLogService");

function notFound() { const e = new Error("Todo not found."); e.statusCode = 404; return e; }
function forbidden(){ const e = new Error("Access denied.");  e.statusCode = 403; return e; }

// BUG #4 FIX: Lazy accessor for the Socket.io instance. The Express app
// registers io via `app.set("io", io)` on startup (see server.js). We
// lazy-require the app INSIDE this getter to avoid a circular import
// (app.js → routes → controllers → services → app.js).
function getIo() {
  try {
    return require("../app").get("io");
  } catch {
    return null;
  }
}

// Broadcast a todo toggle to all team members in the team room.
function broadcastTodoToggle(todo) {
  const io = getIo();
  if (!io || !todo.teamId) return;
  io.to(`team:${todo.teamId}`).emit("todo:toggled", {
    todoId: todo._id.toString(),
    isDone: todo.isDone,
    toggledAt: new Date().toISOString(),
  });
}

async function canAccessTodo(todo, userId) {
  if (todo.userId.equals(userId)) return true;        // own todo
  if (todo.teamId) {
    const team = await Team.findById(todo.teamId);
    if (team && (team.isMember(userId) || team.ownerId.equals(userId))) return true;
  }
  return false;
}

async function findAccessibleTodo(todoId, userId) {
  const todo = await Todo.findById(todoId);
  if (!todo) throw notFound();
  if (!(await canAccessTodo(todo, userId))) throw forbidden();
  return todo;
}

/**
 * getTodos
 * Returns personal todos OR team todos depending on query.teamId.
 * Supports filtering by isDone, priority, assignedTo.
 */
async function getTodos(userId, query) {
  const { teamId, isDone, priority, assignedTo, page = 1, limit = 50 } = query;

  let filter;
  if (teamId) {
    const team = await Team.findById(teamId);
    if (!team || (!team.isMember(userId) && !team.ownerId.equals(userId)))
      throw forbidden("Not a team member.");
    filter = { teamId };
  } else {
    filter = { userId, teamId: null };  // strictly personal
  }

  if (isDone     !== undefined) filter.isDone     = isDone === "true";
  if (priority)                 filter.priority   = priority;
  if (assignedTo)               filter.assignedTo = assignedTo;

  const skip  = (Number(page) - 1) * Number(limit);
  const total = await Todo.countDocuments(filter);
  const todos = await Todo.find(filter)
    .populate("assignedTo", "name email avatar")
    .populate("noteId",     "title")
    .sort({ isDone: 1, position: 1, createdAt: -1 })
    .skip(skip)
    .limit(Number(limit))
    .lean();

  return { todos, meta: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) } };
}

async function getTodoById(todoId, userId) {
  const todo = await Todo.findById(todoId)
    .populate("assignedTo", "name email avatar")
    .populate("noteId",     "title");
  if (!todo) throw notFound();
  if (!(await canAccessTodo(todo, userId))) throw forbidden();
  return todo;
}

async function createTodo(userId, data) {
  let actorName = "";
  if (data.teamId) {
    const team = await Team.findById(data.teamId);
    if (!team || (!team.isMember(userId) && !team.ownerId.equals(userId)))
      throw forbidden("Not a team member.");
    try {
      const actor = await User.findById(userId).select("name").lean();
      actorName = actor?.name || "";
    } catch { /* best-effort */ }
  }
  const todo = await Todo.create({ ...data, userId });

  if (todo.teamId) {
    await logAction({
      teamId: todo.teamId,
      actorId: userId,
      actorName,
      action: "todo.create",
      description: `created todo “${todo.title}”`,
      targetType: "todo",
      targetId: todo._id,
      targetName: todo.title,
      metadata: { priority: todo.priority, dueDate: todo.dueDate },
    }).catch(() => {});

    // BUG #4 FIX: Notify team members a new todo was created so lists refresh
    // instantly (no polling).
    const io = getIo();
    if (io) io.to(`team:${todo.teamId}`).emit("todo:created", {
      teamId: todo.teamId.toString(),
      todoId: todo._id.toString(),
    });
  }

  return todo;
}

async function updateTodo(todoId, userId, updates) {
  const todo = await findAccessibleTodo(todoId, userId);

  // Only the creator can edit; team members can mark done/undone only
  if (!todo.userId.equals(userId)) {
    const allowed = ["isDone", "position"];
    const keys    = Object.keys(updates);
    if (keys.some((k) => !allowed.includes(k)))
      throw forbidden("Team members can only check/uncheck todos.");
  }

  const prevIsDone = todo.isDone;
  Object.assign(todo, updates);
  if (updates.isDone === true  && !todo.doneAt) todo.doneAt = new Date();
  if (updates.isDone === false)                  todo.doneAt = null;

  await todo.save();

  // Log team todo updates — especially ticking/unticking (the action members can perform)
  if (todo.teamId) {
    let action = "todo.update";
    let description = `updated todo “${todo.title}”`;
    if (updates.isDone !== undefined && updates.isDone !== prevIsDone) {
      action = "todo.toggle";
      description = `${todo.isDone ? "checked" : "unchecked"} todo “${todo.title}”`;
    }
    await logAction({
      teamId: todo.teamId,
      actorId: userId,
      action,
      description,
      targetType: "todo",
      targetId: todo._id,
      targetName: todo.title,
      metadata: { updatedFields: Object.keys(updates), isDone: todo.isDone },
    }).catch(() => {});

    // BUG #4 FIX: Broadcast toggle when isDone changed via update endpoint.
    if (updates.isDone !== undefined && updates.isDone !== prevIsDone) {
      broadcastTodoToggle(todo);
    }
  }

  return todo;
}

async function deleteTodo(todoId, userId) {
  const todo = await findAccessibleTodo(todoId, userId);
  if (!todo.userId.equals(userId)) throw forbidden("Only the creator can delete a todo.");
  const teamId = todo.teamId;
  const todoTitle = todo.title;
  await Todo.findByIdAndDelete(todoId);

  if (teamId) {
    await logAction({
      teamId,
      actorId: userId,
      action: "todo.delete",
      description: `deleted todo “${todoTitle}”`,
      targetType: "todo",
      targetId: todoId,
      targetName: todoTitle,
    }).catch(() => {});

    // BUG #4 FIX: Notify team members a todo was deleted so lists refresh.
    const io = getIo();
    if (io) io.to(`team:${teamId}`).emit("todo:deleted", {
      teamId: teamId.toString(),
      todoId: todoId.toString(),
    });
  }
}

async function toggleTodo(todoId, userId) {
  const todo = await findAccessibleTodo(todoId, userId);
  const prevIsDone = todo.isDone;
  if (todo.isDone) await todo.markUndone();
  else             await todo.markDone();

  // Log team todo toggles — this is the primary action members perform on
  // team todos, so it's important to capture who ticked what and when.
  if (todo.teamId) {
    await logAction({
      teamId: todo.teamId,
      actorId: userId,
      action: "todo.toggle",
      description: `${todo.isDone ? "checked" : "unchecked"} todo “${todo.title}”`,
      targetType: "todo",
      targetId: todo._id,
      targetName: todo.title,
      metadata: { isDone: todo.isDone, previousIsDone: prevIsDone },
    }).catch(() => {});

    // BUG #4 FIX: Broadcast the toggle to all team members in real time so
    // other members' todo lists update instantly without polling.
    broadcastTodoToggle(todo);
  }

  return todo;
}

/**
 * getTodoStats — summary for dashboard widgets
 */
async function getTodoStats(userId, teamId = null) {
  const filter = teamId ? { teamId } : { userId, teamId: null };
  const [total, done, overdue] = await Promise.all([
    Todo.countDocuments(filter),
    Todo.countDocuments({ ...filter, isDone: true }),
    Todo.countDocuments({ ...filter, isDone: false, dueDate: { $lt: new Date() } }),
  ]);
  return { total, done, pending: total - done, overdue };
}

module.exports = { getTodos, getTodoById, createTodo, updateTodo, deleteTodo, toggleTodo, getTodoStats };
