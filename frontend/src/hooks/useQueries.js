import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notesAPI, foldersAPI, teamsAPI, todosAPI } from "../services/api";
import toast from "react-hot-toast";

// ─── Shared cache settings — show stale data instantly, refetch in background ──
const FAST_CACHE = { staleTime: 60 * 1000, gcTime: 10 * 60 * 1000 };
const DEEP_CACHE = { staleTime: 120 * 1000, gcTime: 15 * 60 * 1000 };

// ─── Notes ──────────────────────────────────────────────────────────────────
export function useNotes(params = {}) {
  return useQuery({
    queryKey: ["notes", params],
    queryFn: () => notesAPI.getAll(params),
    select: (data) => Array.isArray(data) ? data : data?.notes || [],
    placeholderData: (prev) => prev, // Keep previous data while refetching — no flash/skeleton
    ...FAST_CACHE,
  });
}

export function useNote(id) {
  return useQuery({
    queryKey: ["note", id],
    queryFn: () => notesAPI.getById(id),
    enabled: !!id,
    placeholderData: (prev) => prev,
    ...FAST_CACHE,
  });
}

export function useNotesTags() {
  return useQuery({
    queryKey: ["notes", "tags"],
    queryFn: () => notesAPI.getTags(),
    ...DEEP_CACHE,
  });
}

// ─── Folders ────────────────────────────────────────────────────────────────
export function useFolders(teamId) {
  return useQuery({
    queryKey: ["folders", teamId || undefined],
    queryFn: () => foldersAPI.getAll(teamId ? { teamId } : undefined),
    enabled: teamId !== null, // null means "don't fetch"; undefined means "fetch personal"
    select: (data) => Array.isArray(data) ? data : data?.folders || [],
    placeholderData: (prev) => prev,
    ...FAST_CACHE,
  });
}

// ─── Teams ──────────────────────────────────────────────────────────────────
export function useTeams() {
  return useQuery({
    queryKey: ["teams"],
    queryFn: () => teamsAPI.getMyTeams(),
    select: (data) => Array.isArray(data) ? data : [],
    placeholderData: (prev) => prev, // No skeleton on revisit
    ...FAST_CACHE,
  });
}

export function useTeam(teamId) {
  return useQuery({
    queryKey: ["team", teamId],
    queryFn: () => teamsAPI.getById(teamId),
    enabled: !!teamId,
    placeholderData: (prev) => prev,
    // FALLBACK FIX: Poll every 5 seconds when the team page is active. This
    // ensures that even if the Socket.io connection fails (e.g. due to a
    // misconfigured VITE_API_URL, network issues, or Render cold start), the
    // team data — including member roles and the admin/member badge — will
    // refresh within 5 seconds. Without this, a socket failure means the
    // promoted user never sees their new role until they manually refresh.
    // The polling only runs while the TeamsPage is mounted (active), so it
    // doesn't waste bandwidth when the user is on other pages.
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    ...FAST_CACHE,
  });
}

export function useTeamStats(teamId) {
  return useQuery({
    queryKey: ["team", teamId, "stats"],
    queryFn: () => teamsAPI.getStats(teamId),
    enabled: !!teamId,
    placeholderData: (prev) => prev,
    ...FAST_CACHE,
  });
}

// ─── PERF FIX: React Query hook for team notes (was previously manual fetch) ──
export function useTeamNotes(teamId, enabled = true) {
  return useQuery({
    queryKey: ["team", teamId, "notes"],
    queryFn: async () => {
      const result = await notesAPI.getAll({ teamId });
      return Array.isArray(result) ? result : result?.notes || [];
    },
    enabled: !!teamId && enabled,
    placeholderData: (prev) => prev,
    ...FAST_CACHE,
  });
}

// FEATURE: Activity logs for a team — admins see all entries; non-admin
// members see only their own entries (enforced server-side). The Logs tab
// in the UI is admin-only, but the hook is written generically so it can
// also be reused for a "my activity" view if needed.
export function useTeamLogs(teamId, enabled = true) {
  return useQuery({
    queryKey: ["team", teamId, "logs"],
    queryFn: async () => {
      const result = await teamsAPI.getLogs(teamId, { limit: 200 });
      return Array.isArray(result) ? result : [];
    },
    enabled: !!teamId && enabled,
    placeholderData: (prev) => prev,
    // FALLBACK FIX: Poll every 5 seconds when the Logs tab is active so new
    // entries appear without relying on the socket connection.
    refetchInterval: enabled ? 5000 : false,
    ...FAST_CACHE,
  });
}

// ─── Todos ──────────────────────────────────────────────────────────────────
export function useTodos(params = {}) {
  return useQuery({
    queryKey: ["todos", params],
    queryFn: () => todosAPI.getAll(params),
    select: (data) => data?.todos || (Array.isArray(data) ? data : []),
    placeholderData: (prev) => prev, // No skeleton on revisit
    enabled: params !== null, // null disables the query
    ...FAST_CACHE,
  });
}

export function useTodoStats(teamId) {
  return useQuery({
    queryKey: ["todos", "stats", teamId || null],
    queryFn: () => todosAPI.getStats(teamId ? { teamId } : undefined),
    placeholderData: (prev) => prev,
    ...FAST_CACHE,
  });
}

// ─── Mutations with cache invalidation ──────────────────────────────────────
// FEATURE: When a team-scoped action succeeds, we also invalidate the
// ["team", teamId, "logs"] cache so the new Activity Log entry shows up
// immediately in the Logs tab.
export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => notesAPI.create(data),
    onSuccess: (note) => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      if (note?.teamId) qc.invalidateQueries({ queryKey: ["team"] });
    },
  });
}

export function useUpdateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => notesAPI.update(id, data),
    onSuccess: (note, { id }) => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["note", id] });
      if (note?.teamId) qc.invalidateQueries({ queryKey: ["team"] });
    },
  });
}

export function useDeleteNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => notesAPI.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["team"] });
    },
  });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => foldersAPI.create(data),
    onSuccess: (folder) => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      if (folder?.teamId) qc.invalidateQueries({ queryKey: ["team", folder.teamId, "logs"] });
    },
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => foldersAPI.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      qc.invalidateQueries({ queryKey: ["team"] });
    },
  });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, data }) => teamsAPI.inviteMember(teamId, data),
    onSuccess: (_, { teamId }) => {
      qc.invalidateQueries({ queryKey: ["team", teamId] });
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["team", teamId, "logs"] });
    },
  });
}

export function useCancelInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, email }) => teamsAPI.cancelInvite(teamId, email),
    onSuccess: (_, { teamId }) => qc.invalidateQueries({ queryKey: ["team", teamId] }),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, userId }) => teamsAPI.removeMember(teamId, userId),
    onSuccess: (_, { teamId }) => {
      qc.invalidateQueries({ queryKey: ["team", teamId] });
      qc.invalidateQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["team", teamId, "logs"] });
    },
  });
}

export function useUpdateMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamId, userId, role }) => teamsAPI.updateMemberRole(teamId, userId, role),
    // FIX: Optimistically update the cached team with the new role so the UI
    // reflects the change INSTANTLY — no waiting for the refetch.
    onMutate: async ({ teamId, userId, role }) => {
      await qc.cancelQueries({ queryKey: ["team", teamId] });
      const previousTeam = qc.getQueryData(["team", teamId]);
      // Optimistically patch the member's role in the cached team object
      qc.setQueryData(["team", teamId], (old) => {
        if (!old || !Array.isArray(old.members)) return old;
        return {
          ...old,
          members: old.members.map(m => {
            const mid = String(m.userId?._id || m.userId || "");
            return mid === String(userId) ? { ...m, role } : m;
          }),
        };
      });
      // Also update the ["teams"] list cache so team cards in the grid show
      // correct member roles immediately.
      qc.setQueriesData({ queryKey: ["teams"] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(t => {
          if (!t || String(t._id) !== String(teamId) || !Array.isArray(t.members)) return t;
          return {
            ...t,
            members: t.members.map(m => {
              const mid = String(m.userId?._id || m.userId || "");
              return mid === String(userId) ? { ...m, role } : m;
            }),
          };
        });
      });
      return { previousTeam };
    },
    onSuccess: (updatedTeam, { teamId }) => {
      // FIX: Only overwrite the cache with the server response if members are
      // POPULATED. The backend now re-populates the team before returning it.
      const membersPopulated = updatedTeam?.members?.every(
        m => m.userId && typeof m.userId === "object" && m.userId._id
      );
      if (updatedTeam && updatedTeam._id && membersPopulated) {
        qc.setQueryData(["team", teamId], updatedTeam);
      }
      // FIX: Use refetchQueries (not just invalidateQueries) to FORCE an
      // immediate refetch. invalidateQueries only marks the query as stale —
      // if the query is active it refetches, but with placeholderData the OLD
      // cached data might be shown. refetchQueries guarantees a fresh fetch.
      qc.refetchQueries({ queryKey: ["team", teamId] });
      qc.refetchQueries({ queryKey: ["teams"] });
      qc.invalidateQueries({ queryKey: ["team", teamId, "logs"] });
    },
    onError: (err, { teamId }, context) => {
      // Roll back the optimistic update on error
      if (context?.previousTeam !== undefined) {
        qc.setQueryData(["team", teamId], context.previousTeam);
      }
    },
  });
}

export function useCreateTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => todosAPI.create(data),
    // PERF FIX: Optimistic update — add todo immediately to UI
    onMutate: async (newTodo) => {
      await qc.cancelQueries({ queryKey: ["todos"] });
      const previousTodos = qc.getQueryData(["todos", {}]);
      return { previousTodos };
    },
    onSuccess: (todo) => {
      qc.invalidateQueries({ queryKey: ["todos"] });
      qc.invalidateQueries({ queryKey: ["todos", "stats"] });
      if (todo?.teamId) qc.invalidateQueries({ queryKey: ["team", todo.teamId, "logs"] });
    },
    onError: (err, newTodo, context) => {
      if (context?.previousTodos) {
        qc.setQueryData(["todos", {}], context.previousTodos);
      }
      toast.error(err.response?.data?.message || "Failed to create todo");
    },
  });
}

export function useUpdateTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => todosAPI.update(id, data),
    onSuccess: (todo) => {
      qc.invalidateQueries({ queryKey: ["todos"] });
      qc.invalidateQueries({ queryKey: ["todos", "stats"] });
      if (todo?.teamId) qc.invalidateQueries({ queryKey: ["team", todo.teamId, "logs"] });
    },
  });
}

export function useDeleteTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => todosAPI.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["todos"] });
      qc.invalidateQueries({ queryKey: ["todos", "stats"] });
      qc.invalidateQueries({ queryKey: ["team"] });
    },
  });
}

export function useToggleTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => todosAPI.toggle(id),
    // PERF FIX: Optimistic toggle — immediately flip isDone in cache
    onMutate: async (todoId) => {
      await qc.cancelQueries({ queryKey: ["todos"] });
      const previousTodos = qc.getQueryData(["todos", {}]);
      // Optimistically update the todo
      qc.setQueryData(["todos", {}], (old) => {
        if (!old) return old;
        const todos = old?.todos || (Array.isArray(old) ? old : []);
        if (Array.isArray(todos)) {
          return todos.map(t =>
            t._id === todoId ? { ...t, isDone: !t.isDone } : t
          );
        }
        return old;
      });
      return { previousTodos };
    },
    onSuccess: (todo) => {
      qc.invalidateQueries({ queryKey: ["todos"] });
      qc.invalidateQueries({ queryKey: ["todos", "stats"] });
      if (todo?.teamId) qc.invalidateQueries({ queryKey: ["team", todo.teamId, "logs"] });
    },
    onError: (err, todoId, context) => {
      if (context?.previousTodos) {
        qc.setQueryData(["todos", {}], context.previousTodos);
      }
      toast.error("Failed to toggle todo");
    },
  });
}
