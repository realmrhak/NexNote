/**
 * React hooks for Socket.io real-time collaboration.
 *
 * - useNoteSocket(noteId, handlers, options)
 *     Joins a note room on mount, leaves on unmount. Calls handlers when
 *     other editors update the note or join/leave the room.
 *
 * - useTeamSocket(teamId, handlers)
 *     Joins a single team room on mount. Used by TeamsPage for page-specific
 *     UI behaviors (toasts, optimistic updates on the currently-viewed team).
 *
 * - useGlobalTeamSocket(user)
 *     MOUNTED ONCE AT THE APP LEVEL. Joins ALL of the user's team rooms at
 *     login and listens for `member:roleUpdated`, `log:created`,
 *     `note:list:changed`, `todo:*` events GLOBALLY — so cache invalidation
 *     happens regardless of which page the user is currently on. This is the
 *     fix for "user has to reload the website after being promoted" and
 *     "activity logs don't refresh in real-time".
 *
 * Both per-page hooks are designed to be safe with React StrictMode double-mount.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "../services/socket";
import { teamsAPI, authAPI } from "../services/api";

/**
 * Note room hook.
 *
 * @param {string|null} noteId
 * @param {{
 *   onUpdated?: (payload: any) => void,
 *   onSomeoneEditing?: (payload: any) => void,
 *   onUserLeft?: (payload: any) => void,
 *   onDeleted?: (payload: any) => void,
 *   onError?: (payload: any) => void,
 * }} handlers
 * @param {{ emitUpdates?: boolean, getUpdatePayload?: () => any }} [options]
 *   If emitUpdates is true, the hook emits a `note:update` event whenever
 *   getUpdatePayload() returns a non-null payload. This is useful for the
 *   NoteEditor to broadcast debounced typing.
 */
export function useNoteSocket(noteId, handlers, options = {}) {
  const handlersRef = useRef(handlers);
  const optionsRef = useRef(options);

  // Keep refs in sync without re-running the join effect.
  useEffect(() => {
    handlersRef.current = handlers;
    optionsRef.current = options;
  }, [handlers, options]);

  useEffect(() => {
    if (!noteId) return;

    const socket = getSocket();
    if (!socket) return;

    // If the socket isn't connected yet, wait for it to connect before joining.
    function join() {
      socket.emit("note:join", { noteId });
    }
    if (socket.connected) join();
    else socket.once("connect", join);

    // Listeners — delegate to whatever handlers are currently registered.
    function onUpdatedHandler(payload) {
      if (payload?.noteId && String(payload.noteId) !== String(noteId)) return;
      handlersRef.current.onUpdated?.(payload);
    }
    function onSomeoneEditingHandler(payload) {
      if (payload?.noteId && String(payload.noteId) !== String(noteId)) return;
      handlersRef.current.onSomeoneEditing?.(payload);
    }
    function onUserLeftHandler(payload) {
      if (payload?.noteId && String(payload.noteId) !== String(noteId)) return;
      handlersRef.current.onUserLeft?.(payload);
    }
    function onDeletedHandler(payload) {
      if (payload?.noteId && String(payload.noteId) !== String(noteId)) return;
      handlersRef.current.onDeleted?.(payload);
    }
    function onErrorHandler(payload) {
      handlersRef.current.onError?.(payload);
    }

    socket.on("note:updated", onUpdatedHandler);
    socket.on("note:someone-editing", onSomeoneEditingHandler);
    socket.on("note:user-left", onUserLeftHandler);
    socket.on("note:deleted", onDeletedHandler);
    socket.on("note:error", onErrorHandler);

    return () => {
      socket.emit("note:leave", { noteId });
      socket.off("note:updated", onUpdatedHandler);
      socket.off("note:someone-editing", onSomeoneEditingHandler);
      socket.off("note:user-left", onUserLeftHandler);
      socket.off("note:deleted", onDeletedHandler);
      socket.off("note:error", onErrorHandler);
      socket.off("connect", join);
    };
  }, [noteId]);
}

/**
 * Emit a `note:update` event to broadcast the latest note content to other
 * editors. Safe to call from a debounced handler. Returns true on success.
 */
export function emitNoteUpdate(noteId, payload) {
  const socket = getSocket();
  if (!socket || !socket.connected || !noteId) return false;
  socket.emit("note:update", { noteId, ...payload });
  return true;
}

/**
 * Team room hook.
 *
 * @param {string|null} teamId
 * @param {{
 *   onTodoToggled?: (payload: any) => void,
 *   onTodoCreated?: (payload: any) => void,
 *   onTodoDeleted?: (payload: any) => void,
 *   onNoteListChanged?: (payload: any) => void,
 *   onMemberRoleUpdated?: (payload: any) => void,
 * }} handlers
 */
export function useTeamSocket(teamId, handlers) {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!teamId) return;

    const socket = getSocket();
    if (!socket) return;

    function join() {
      socket.emit("team:join", { teamId });
    }
    if (socket.connected) join();
    else socket.once("connect", join);

    function todoToggledHandler(payload) {
      if (payload?.teamId && String(payload.teamId) !== String(teamId)) return;
      handlersRef.current.onTodoToggled?.(payload);
    }
    function todoCreatedHandler(payload) {
      if (payload?.teamId && String(payload.teamId) !== String(teamId)) return;
      handlersRef.current.onTodoCreated?.(payload);
    }
    function todoDeletedHandler(payload) {
      if (payload?.teamId && String(payload.teamId) !== String(teamId)) return;
      handlersRef.current.onTodoDeleted?.(payload);
    }
    function noteListChangedHandler(payload) {
      if (payload?.teamId && String(payload.teamId) !== String(teamId)) return;
      handlersRef.current.onNoteListChanged?.(payload);
    }
    // REAL-TIME FIX #2: When an admin/owner changes a member's role
    // (member ↔ admin), the backend broadcasts `member:roleUpdated` to all
    // team members. We invalidate the team query cache so the Members list
    // re-fetches with the new role instantly — no page reload required.
    function memberRoleUpdatedHandler(payload) {
      if (payload?.teamId && String(payload.teamId) !== String(teamId)) return;
      handlersRef.current.onMemberRoleUpdated?.(payload);
    }

    socket.on("todo:toggled", todoToggledHandler);
    socket.on("todo:created", todoCreatedHandler);
    socket.on("todo:deleted", todoDeletedHandler);
    socket.on("note:list:changed", noteListChangedHandler);
    socket.on("member:roleUpdated", memberRoleUpdatedHandler);

    return () => {
      socket.emit("team:leave", { teamId });
      socket.off("todo:toggled", todoToggledHandler);
      socket.off("todo:created", todoCreatedHandler);
      socket.off("todo:deleted", todoDeletedHandler);
      socket.off("note:list:changed", noteListChangedHandler);
      socket.off("member:roleUpdated", memberRoleUpdatedHandler);
      socket.off("connect", join);
    };
  }, [teamId]);
}

// ────────────────────────────────────────────────────────────────────────────
// GLOBAL team socket — mounted ONCE at the App level after login.
//
// WHY THIS EXISTS
// ===============
// The per-page `useTeamSocket(selectedTeamId, ...)` hook only listens while
// the user is ON the TeamsPage AND only for the currently-selected team.
// This caused two real-world bugs:
//
//   1. "User has to reload the website after being promoted to admin."
//      If the user was on the Dashboard (or a different team's page) when
//      they were promoted, no socket listener was active → no cache
//      invalidation → no UI update → forced reload.
//
//   2. "Activity logs don't refresh in real-time."
//      The backend never emitted a `log:created` socket event at all, so
//      even users on the Logs tab had to manually refresh to see new entries.
//
// THE FIX
// =======
// This hook:
//   1. Fetches ALL of the user's teams (via the `teams` React Query cache).
//   2. Joins EVERY team room at once — so events arrive regardless of which
//      page the user is on.
//   3. Listens for `member:roleUpdated`, `log:created`, `note:list:changed`,
//      `todo:*` events and uses `payload.teamId` (NOT a closure variable)
//      to invalidate the correct React Query cache entries.
//   4. If the role change affects the CURRENT USER, refreshes their session
//      (`/api/auth/me`) so the sidebar / permissions / admin-only actions
//      update immediately — no reload needed.
//
// The per-page `useTeamSocket` hook is still used by TeamsPage for
// page-specific UX (toasts, optimistic UI on the currently-viewed team).
// This global hook is purely for CACHE INVALIDATION across the whole app.
// ────────────────────────────────────────────────────────────────────────────
export function useGlobalTeamSocket(user, onSelfRoleChanged) {
  const qc = useQueryClient();
  const onSelfRoleChangedRef = useRef(onSelfRoleChanged);
  useEffect(() => {
    onSelfRoleChangedRef.current = onSelfRoleChanged;
  }, [onSelfRoleChanged]);

  // Keep a stable ref to the current user id so the listener closure always
  // sees the latest value without re-subscribing on every user change.
  const userIdRef = useRef(user?.id || user?._id || null);
  useEffect(() => {
    userIdRef.current = user?.id || user?._id || null;
  }, [user]);

  // We don't actually need the teams list to subscribe — Socket.io server
  // already authenticates the user and only delivers events for teams they
  // are a member of (the server joins them to `team:<id>` rooms on
  // `team:join`). But we DO need to actively `team:join` every team room
  // after login so the server knows to broadcast events to this socket.
  // We fetch the team list once on mount, then join each room.
  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    if (!socket) return;

    let joinedTeamIds = new Set();

    async function joinAllTeams() {
      try {
        const teams = await teamsAPI.getMyTeams();
        if (!Array.isArray(teams)) return;
        teams.forEach((t) => {
          const id = String(t._id);
          if (!joinedTeamIds.has(id)) {
            joinedTeamIds.add(id);
            socket.emit("team:join", { teamId: id });
          }
        });
      } catch {
        // If the fetch fails (server cold-starting, etc.), we'll retry on
        // the next mount or when the user navigates. The per-page
        // useTeamSocket also still works as a fallback.
      }
    }

    if (socket.connected) joinAllTeams();
    else socket.once("connect", joinAllTeams);

    // ─── Global listeners ──────────────────────────────────────────────────
    // All handlers use `payload.teamId` to invalidate the RIGHT cache entry,
    // regardless of which team the user is currently viewing.
    function memberRoleUpdatedHandler(payload) {
      const teamId = payload?.teamId;
      if (!teamId) return;
      qc.invalidateQueries({ queryKey: ["team", teamId] });
      qc.invalidateQueries({ queryKey: ["team", teamId, "logs"] });
      qc.invalidateQueries({ queryKey: ["team", teamId, "stats"] });
      qc.invalidateQueries({ queryKey: ["teams"] }); // refresh team list (role badge in cards)

      // If the role change affects the CURRENT USER, refresh their session
      // so the sidebar / permissions / admin-only actions update without a
      // page reload.
      const me = String(userIdRef.current || "");
      if (payload?.memberId && String(payload.memberId) === me) {
        // Fire-and-forget — refresh /auth/me to get updated user data.
        authAPI.getMe()
          .then((freshUser) => {
            // Update the cached user object via the AuthContext setter.
            // We can't call setUser directly from here (it lives in
            // AuthContext), so we expose a callback (`onSelfRoleChanged`)
            // that the App passes down.
            onSelfRoleChangedRef.current?.(freshUser, payload);
          })
          .catch(() => { /* best-effort */ });
      }
    }

    function logCreatedHandler(payload) {
      const teamId = payload?.teamId;
      if (!teamId) return;
      // Invalidate the logs cache so the Logs tab refreshes INSTANTLY when
      // a new log entry is created anywhere in the team.
      qc.invalidateQueries({ queryKey: ["team", teamId, "logs"] });
    }

    function noteListChangedHandler(payload) {
      const teamId = payload?.teamId;
      if (!teamId) return;
      qc.invalidateQueries({ queryKey: ["team", teamId, "notes"] });
      qc.invalidateQueries({ queryKey: ["team", teamId, "stats"] });
      qc.invalidateQueries({ queryKey: ["team", teamId, "logs"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
    }

    function todoToggledHandler(payload) {
      const teamId = payload?.teamId;
      if (!teamId) return;
      qc.invalidateQueries({ queryKey: ["todos"] });
      qc.invalidateQueries({ queryKey: ["todos", "stats"] });
      qc.invalidateQueries({ queryKey: ["team", teamId, "logs"] });
    }
    function todoCreatedHandler(payload) {
      const teamId = payload?.teamId;
      if (!teamId) return;
      qc.invalidateQueries({ queryKey: ["todos"] });
      qc.invalidateQueries({ queryKey: ["todos", "stats"] });
      qc.invalidateQueries({ queryKey: ["team", teamId, "logs"] });
    }
    function todoDeletedHandler(payload) {
      const teamId = payload?.teamId;
      if (!teamId) return;
      qc.invalidateQueries({ queryKey: ["todos"] });
      qc.invalidateQueries({ queryKey: ["todos", "stats"] });
      qc.invalidateQueries({ queryKey: ["team", teamId, "logs"] });
    }

    socket.on("member:roleUpdated", memberRoleUpdatedHandler);
    socket.on("log:created", logCreatedHandler);
    socket.on("note:list:changed", noteListChangedHandler);
    socket.on("todo:toggled", todoToggledHandler);
    socket.on("todo:created", todoCreatedHandler);
    socket.on("todo:deleted", todoDeletedHandler);

    return () => {
      // Leave all team rooms on unmount / logout
      joinedTeamIds.forEach((id) => {
        try { socket.emit("team:leave", { teamId: id }); } catch { /* ignore */ }
      });
      joinedTeamIds.clear();
      socket.off("member:roleUpdated", memberRoleUpdatedHandler);
      socket.off("log:created", logCreatedHandler);
      socket.off("note:list:changed", noteListChangedHandler);
      socket.off("todo:toggled", todoToggledHandler);
      socket.off("todo:created", todoCreatedHandler);
      socket.off("todo:deleted", todoDeletedHandler);
      socket.off("connect", joinAllTeams);
    };
  }, [user, qc]);
}
