/**
 * Socket.io server setup for real-time collaboration.
 *
 * Supports two collaboration channels:
 *
 *  1. Note rooms (`note:<noteId>`)
 *     - `note:join`        — join a note room (other editors are notified)
 *     - `note:leave`       — leave a note room (cleanup on unmount)
 *     - `note:update`      — persist new content & broadcast to other editors
 *     - `note:someone-editing` — pushed TO all OTHER editors when someone joins
 *     - `note:updated`     — pushed TO all OTHER editors when content changes
 *     - `note:error`       — pushed back to the sender on failure
 *
 *  2. Team rooms (`team:<teamId>`)
 *     - `team:join`        — join a team room (for todo / note list live updates)
 *     - `team:leave`       — leave a team room
 *     - `todo:toggled`     — broadcast TO team members when a todo is ticked
 *     - `note:list:changed`— broadcast TO team members when a note is created/
 *                             deleted/updated (so the team notes list refreshes)
 *
 * Auth: the socket handshake must include `auth.token` = a valid access JWT.
 * Unauthenticated sockets are rejected with an `unauthorized` error.
 */
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Note = require("../models/Note");
const Todo = require("../models/Todo");
const Team = require("../models/Team");
const logger = require("../utils/logger");

/**
 * Attach a Socket.io server to the given HTTP server.
 *
 * @param {import("http").Server} server
 * @param {Function} corsOriginResolver — same origin resolver used by Express CORS
 */
function initSockets(server, corsOriginResolver) {
  const io = require("socket.io")(server, {
    cors: {
      origin: corsOriginResolver,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    },
    // Render.com and most PaaS proxies need this enabled for WebSockets.
    transports: ["websocket", "polling"],
  });

  // ─── Auth middleware ──────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        return next(new Error("unauthorized: no token"));
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("-password -refreshToken");
      if (!user || !user.isActive) {
        return next(new Error("unauthorized: user not found"));
      }
      // Attach a minimal user object for handlers
      socket.user = { _id: user._id, name: user.name, email: user.email };
      next();
    } catch (err) {
      next(new Error("unauthorized: " + (err.message || "invalid token")));
    }
  });

  // ─── Connection handler ───────────────────────────────────────────────────
  io.on("connection", (socket) => {
    logger.info(`[socket] connected: ${socket.user.name} (${socket.id})`);

    // Track which rooms this socket has joined so we can clean up on disconnect.
    const joinedRooms = new Set();

    // ─── Note rooms ───────────────────────────────────────────────────────
    socket.on("note:join", async ({ noteId }) => {
      try {
        if (!noteId) return;
        // Verify the user can access this note (personal owner OR team member).
        const note = await Note.findById(noteId);
        if (!note) return socket.emit("note:error", { message: "Note not found" });

        const isOwner = note.userId.equals(socket.user._id);
        let canAccess = isOwner;
        if (!isOwner && note.teamId) {
          const team = await Team.findById(note.teamId);
          canAccess = !!(team && (team.isMember(socket.user._id) || team.ownerId.equals(socket.user._id)));
        }
        if (!canAccess) return socket.emit("note:error", { message: "Access denied" });

        const room = `note:${noteId}`;
        socket.join(room);
        joinedRooms.add(room);
        // Tell OTHER editors in the room that someone joined (so they can show
        // the "X is editing..." indicator).
        socket.to(room).emit("note:someone-editing", {
          noteId,
          userName: socket.user.name,
          userId: socket.user._id.toString(),
        });
      } catch (err) {
        logger.error(`[socket] note:join error: ${err.message}`);
        socket.emit("note:error", { message: "Failed to join note room" });
      }
    });

    socket.on("note:leave", ({ noteId }) => {
      if (!noteId) return;
      const room = `note:${noteId}`;
      socket.leave(room);
      joinedRooms.delete(room);
      // Notify others so they can clear the "X is editing..." indicator.
      socket.to(room).emit("note:user-left", {
        noteId,
        userName: socket.user.name,
        userId: socket.user._id.toString(),
      });
    });

    // Real-time note update: persist + broadcast to other editors.
    socket.on("note:update", async ({ noteId, title, body, tags, updatedBy }) => {
      try {
        if (!noteId) return;
        const note = await Note.findById(noteId);
        if (!note) return socket.emit("note:error", { message: "Note not found" });

        // Authorize: owner OR team member
        const isOwner = note.userId.equals(socket.user._id);
        let canEdit = isOwner;
        if (!isOwner && note.teamId) {
          const team = await Team.findById(note.teamId);
          canEdit = !!(team && (team.isMember(socket.user._id) || team.ownerId.equals(socket.user._id)));
        }
        if (!canEdit) return socket.emit("note:error", { message: "Access denied" });

        // Apply updates — only fields that were provided.
        const updates = {};
        if (typeof title === "string") updates.title = title;
        if (typeof body === "string") updates.body = body;
        if (Array.isArray(tags)) updates.tags = tags;
        // Explicitly forbid ownership transfer via socket.
        delete updates.userId;
        delete updates.teamId;

        Object.assign(note, updates);
        await note.save();

        const room = `note:${noteId}`;
        // Broadcast to OTHER sockets in the room (not the sender).
        socket.to(room).emit("note:updated", {
          noteId,
          title: note.title,
          body: note.body,
          tags: note.tags,
          updatedBy: updatedBy || socket.user.name,
          updatedAt: note.updatedAt,
        });

        // Also notify team room (if this is a team note) so list views refresh.
        if (note.teamId) {
          io.to(`team:${note.teamId}`).emit("note:list:changed", {
            noteId,
            teamId: note.teamId.toString(),
            action: "update",
          });
        }
      } catch (err) {
        logger.error(`[socket] note:update error: ${err.message}`);
        socket.emit("note:error", { message: "Update failed: " + err.message });
      }
    });

    // ─── Team rooms ───────────────────────────────────────────────────────
    socket.on("team:join", async ({ teamId }) => {
      try {
        if (!teamId) return;
        const team = await Team.findById(teamId);
        if (!team) return;
        const isMember = team.isMember(socket.user._id) || team.ownerId.equals(socket.user._id);
        if (!isMember) return;

        const room = `team:${teamId}`;
        socket.join(room);
        joinedRooms.add(room);
      } catch (err) {
        logger.error(`[socket] team:join error: ${err.message}`);
      }
    });

    socket.on("team:leave", ({ teamId }) => {
      if (!teamId) return;
      const room = `team:${teamId}`;
      socket.leave(room);
      joinedRooms.delete(room);
    });

    // Real-time todo toggle: persist + broadcast to team members.
    // NOTE: This is in ADDITION to the existing REST endpoint — both paths go
    // through the same todoService.toggleTodo to keep behavior consistent.
    // The REST endpoint remains the source of truth for the toggling user
    // (so they get the optimistic UI + final state back); this socket handler
    // is purely for broadcasting the change to OTHER team members in real time.
    socket.on("todo:toggle", async ({ todoId, teamId }) => {
      try {
        if (!todoId) return;
        const todo = await Todo.findById(todoId);
        if (!todo) return;

        // Verify access (owner OR team member)
        const isOwner = todo.userId.equals(socket.user._id);
        let canAccess = isOwner;
        if (!isOwner && todo.teamId) {
          const team = await Team.findById(todo.teamId);
          canAccess = !!(team && (team.isMember(socket.user._id) || team.ownerId.equals(socket.user._id)));
        }
        if (!canAccess) return;

        // Broadcast to the team room (everyone EXCEPT the sender). The sender
        // already updated their own UI optimistically via the REST mutation.
        const room = `team:${teamId || (todo.teamId && todo.teamId.toString())}`;
        if (room !== "team:null" && room !== "team:undefined") {
          socket.to(room).emit("todo:toggled", {
            todoId,
            isDone: todo.isDone, // current state after the REST toggle
            toggledBy: socket.user.name,
            toggledByUserId: socket.user._id.toString(),
          });
        }
      } catch (err) {
        logger.error(`[socket] todo:toggle error: ${err.message}`);
      }
    });

    // ─── Disconnect cleanup ───────────────────────────────────────────────
    socket.on("disconnect", () => {
      logger.info(`[socket] disconnected: ${socket.user.name} (${socket.id})`);
      // Notify any note rooms that this user left (so others clear the
      // "X is editing..." indicator).
      joinedRooms.forEach((room) => {
        if (room.startsWith("note:")) {
          const noteId = room.slice("note:".length);
          socket.to(room).emit("note:user-left", {
            noteId,
            userName: socket.user.name,
            userId: socket.user._id.toString(),
          });
        }
      });
      joinedRooms.clear();
    });
  });

  return io;
}

module.exports = { initSockets };
