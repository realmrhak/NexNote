import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import { useQueryClient } from "@tanstack/react-query";
import Sidebar from "../components/Sidebar";
import Modal from "../components/Modal";
import { teamsAPI, notesAPI, foldersAPI, todosAPI } from "../services/api";
import { useTeams, useTeam, useTeamStats, useInviteMember, useCancelInvite, useRemoveMember, useUpdateMemberRole, useTeamNotes, useTeamLogs } from "../hooks/useQueries";
import { useTodos, useTodoStats, useCreateTodo, useUpdateTodo, useDeleteTodo, useToggleTodo } from "../hooks/useQueries";
import { useFolders } from "../hooks/useQueries";
import { useTeamSocket } from "../hooks/useSockets";
import { TeamGridSkeleton } from "../components/Skeletons";
import { getFolderId, getTeamId } from "../utils/helpers";
import "../styles/teams.css";
import "../styles/todos.css";

export default function TeamsPage({
  dark, user, notes, folders, onBack, toggleDark, onLogout, onAddFolder, onFolderDelete,
  onGoNotes, onGoTodos, onGoProfile, onCreateNote, onOpenNote, onRefresh, onFolderOpen,
  creatingNote = false,
  // BUG 4 FIX: selectedTeamId is now owned by App.jsx so it survives
  // navigation away from the Teams screen (e.g., into a folder). This means
  // pressing Back from FolderDetail returns the user to the SAME team they
  // came from, not the Teams grid.
  selectedTeamId: controlledSelectedTeamId = null,
  setSelectedTeamId: controlledSetSelectedTeamId = () => {},
}) {
  const selectedTeamId = controlledSelectedTeamId;
  const setSelectedTeamId = controlledSetSelectedTeamId;
  const [showCreate, setShowCreate]     = useState(false);
  const [newTeam, setNewTeam]           = useState({ name: "", description: "", color: "#2383E2" });
  const [inviteEmail, setInviteEmail]   = useState("");
  const [inviteRole, setInviteRole]     = useState("member");
  const [showInvite, setShowInvite]     = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [error, setError]              = useState("");
  const [sidebarOpen, setSidebarOpen]  = useState(false);
  const [isMobile, setIsMobile]        = useState(window.innerWidth < 768);

  // Team notes & todos state
  // FEATURE: "logs" is the new Activity Logs tab — visible to admins only.
  const [activeTab, setActiveTab]         = useState("members"); // "members" | "notes" | "todos" | "logs"
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Todo state
  const [showCreateTodo, setShowCreateTodo] = useState(false);
  const [newTodo, setNewTodo]             = useState({ title: "", description: "", priority: "medium", dueDate: "" });
  const [todoError, setTodoError]         = useState("");

  // ─── React Query hooks ──────────────────────────────────────────────────────
  const queryClient = useQueryClient();
  const { data: teams = [], isLoading: teamsLoading, isFetching: teamsFetching } = useTeams();
  const { data: selectedTeam, isFetching: teamFetching } = useTeam(selectedTeamId);
  const { data: stats } = useTeamStats(selectedTeamId);
  const { data: teamNotes = [], isFetching: teamNotesFetching } = useTeamNotes(selectedTeamId, activeTab === "notes");
  // FEATURE: Activity logs — only fetched when the Logs tab is active.
  const { data: teamLogs = [], isFetching: teamLogsFetching } = useTeamLogs(selectedTeamId, activeTab === "logs");

  // Team todos — only fetch when a team is selected
  const { data: teamTodosData, isFetching: teamTodosFetching } = useTodos(selectedTeamId ? { teamId: selectedTeamId } : null);
  const teamTodos = teamTodosData || [];
  const { data: teamTodoStats } = useTodoStats(selectedTeamId);

  // FIX: Team folders — only fetch when team is selected AND notes tab is active
  // When team is selected but not on notes tab, don't fetch anything (pass null to disable)
  const { data: teamFoldersData } = useFolders(
    selectedTeamId && activeTab === "notes" ? selectedTeamId : null
  );
  // Filter teamFolders to only include folders for the selected team (extra safety)
  const teamFolders = (teamFoldersData || []).filter(f => {
    const fTeamId = getTeamId(f.teamId);
    return fTeamId === String(selectedTeamId);
  });

  const inviteMutation   = useInviteMember();
  const cancelMutation   = useCancelInvite();
  const removeMutation   = useRemoveMember();
  const roleMutation     = useUpdateMemberRole();

  // Todo mutations
  const createTodoMutation = useCreateTodo();
  const toggleTodoMutation = useToggleTodo();
  const deleteTodoMutation = useDeleteTodo();
  const updateTodoMutation = useUpdateTodo();

  const showTeamsSkeleton = teamsLoading && teams.length === 0;

  // BUG #3/#4 FIX: Subscribe to the team's Socket.io room so that todo
  // toggles, todo creates/deletes, and note list changes by OTHER members
  // are reflected on this user's screen instantly — without polling and
  // without having to refresh the page. The handlers below invalidate the
  // relevant React Query caches, which triggers background refetches with
  // `placeholderData: (prev) => prev` so the UI doesn't flash a skeleton.
  const onTodoToggled = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["todos"] });
    queryClient.invalidateQueries({ queryKey: ["todos", "stats"] });
  }, [queryClient]);
  const onTodoCreated = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["todos"] });
    queryClient.invalidateQueries({ queryKey: ["todos", "stats"] });
  }, [queryClient]);
  const onTodoDeleted = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["todos"] });
    queryClient.invalidateQueries({ queryKey: ["todos", "stats"] });
  }, [queryClient]);
  const onNoteListChanged = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["team", selectedTeamId, "notes"] });
    queryClient.invalidateQueries({ queryKey: ["team", selectedTeamId, "stats"] });
    queryClient.invalidateQueries({ queryKey: ["team", selectedTeamId, "logs"] });
    queryClient.invalidateQueries({ queryKey: ["folders"] });
  }, [queryClient, selectedTeamId]);
  // REAL-TIME FIX: When an admin/owner changes a member's role (member ↔
  // admin), the backend broadcasts `member:roleUpdated`. The GLOBAL socket
  // listener (useGlobalTeamSocket in App.jsx) handles the cache invalidation
  // using `payload.teamId` — so it works even if the user is viewing a
  // different team. This per-page handler only shows a toast for OTHER
  // members' role changes (the current user's toast is handled by the
  // global listener's `onSelfRoleChanged` callback).
  const onMemberRoleUpdated = useCallback((payload) => {
    if (payload?.memberId && payload?.role) {
      const me = String(user?.id || user?._id || "");
      if (payload.memberId !== me) {
        toast(`${payload.updatedByName || "Someone"} changed a member's role to ${payload.role}`, { duration: 2500 });
      }
    }
  }, [user]);

  useTeamSocket(selectedTeamId, {
    onTodoToggled,
    onTodoCreated,
    onTodoDeleted,
    onNoteListChanged,
    onMemberRoleUpdated,
  });

  // FIX: Local folders for sidebar — only show personal folders (team content isolation)
  // The sidebar in teams page should only show personal folders, not team folders
  // to avoid duplicates between sidebar and the team notes tab
  const [localFolders, setLocalFolders] = useState([]);

  useEffect(() => {
    // FIX: Only load personal folders for sidebar, not team folders
    foldersAPI.getAll().then(f => {
      const allFolders = Array.isArray(f) ? f : f?.folders || [];
      // Filter to only personal folders (no teamId) to avoid duplicates
      const personalFolders = allFolders.filter(folder => !getTeamId(folder.teamId));
      setLocalFolders(personalFolders);
    }).catch(() => {});
  }, [folders]);

  useEffect(() => {
    function handleResize() { setIsMobile(window.innerWidth < 768); }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // ─── Team actions ───────────────────────────────────────────────────────────

  async function handleCreateTeam() {
    if (!newTeam.name.trim()) { setError("Team name is required"); return; }
    try {
      await teamsAPI.create(newTeam);
      setShowCreate(false);
      setNewTeam({ name: "", description: "", color: "#2383E2" });
      setError("");
      toast.success("Team created!");
      onRefresh();
    } catch (err) { setError(err.response?.data?.message || "Failed to create team"); }
  }

  async function handleDeleteTeam(id) {
    try {
      await teamsAPI.delete(id);
      if (selectedTeamId === id) setSelectedTeamId(null);
      setDeleteTarget(null);
      toast.success("Team deleted");
      onRefresh();
    } catch (err) { setError(err.response?.data?.message || "Failed to delete team"); }
  }

  async function handleInvite() {
    if (!inviteEmail.trim()) { setError("Email is required"); return; }
    try {
      await inviteMutation.mutateAsync({ teamId: selectedTeamId, data: { email: inviteEmail, role: inviteRole } });
      setShowInvite(false);
      setInviteEmail("");
      setInviteRole("member");
      setError("");
      toast.success("Invitation sent!");
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to send invite";
      setError(msg);
      toast.error(msg);
    }
  }

  async function handleCancelInvite(email) {
    try {
      await cancelMutation.mutateAsync({ teamId: selectedTeamId, email });
      toast.success("Invitation cancelled");
    } catch (err) {
      toast.error("Failed to cancel invite");
    }
  }

  async function handleRemoveMember(userId) {
    try {
      await removeMutation.mutateAsync({ teamId: selectedTeamId, userId });
      toast.success("Member removed");
    } catch (err) {
      toast.error("Failed to remove member");
    }
  }

  // FIX: Role toggle is now a true toggle — the caller passes the member's
  // CURRENT role and we compute the target role (admin ↔ member) here. This
  // makes the UI button unambiguous: ONE button per member that says either
  // "Make Admin" (if currently member) or "Remove Admin" (if currently
  // admin). The previous implementation had two separate conditional buttons
  // which could render neither if the cached role was stale.
  async function handleToggleRole(userId, currentRole) {
    const nextRole = currentRole === "admin" ? "member" : "admin";
    try {
      await roleMutation.mutateAsync({ teamId: selectedTeamId, userId, role: nextRole });
      toast.success(nextRole === "admin" ? "Promoted to Admin" : "Removed Admin role");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update role");
    }
  }

  // Legacy alias kept for any callers that still pass an explicit role.
  async function handleUpdateRole(userId, role) {
    try {
      await roleMutation.mutateAsync({ teamId: selectedTeamId, userId, role });
      toast.success("Role updated");
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update role");
    }
  }

  // FIX #3 (v2): handleUpdateStatus removed — member status field no longer exists.

  function selectTeam(team) {
    setSelectedTeamId(team._id);
    setActiveTab("members");
  }

  async function handleCreateTeamNote() {
    try {
      await onCreateNote({ teamId: selectedTeamId, title: "", body: "", tags: [] });
    } catch (err) {
      toast.error("Failed to create team note");
    }
  }

  // ─── Team folder creation ─────────────────────────────────────────────────
  async function handleCreateTeamFolder() {
    if (!newFolderName.trim()) { toast.error("Folder name is required"); return; }
    try {
      await foldersAPI.create({ name: newFolderName.trim(), teamId: selectedTeamId });
      setNewFolderName("");
      setShowCreateFolder(false);
      toast.success("Team folder created!");
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to create folder");
    }
  }

  // ─── Team todo actions ──────────────────────────────────────────────────────
  async function handleCreateTeamTodo() {
    if (!newTodo.title.trim()) { setTodoError("Title is required"); return; }
    try {
      await createTodoMutation.mutateAsync({
        ...newTodo,
        teamId: selectedTeamId,
        dueDate: newTodo.dueDate || undefined,
      });
      setShowCreateTodo(false);
      setNewTodo({ title: "", description: "", priority: "medium", dueDate: "" });
      setTodoError("");
      toast.success("Team todo created!");
    } catch (err) {
      setTodoError(err.response?.data?.message || "Failed to create todo");
    }
  }

  async function handleToggleTodo(todoId) {
    try {
      await toggleTodoMutation.mutateAsync(todoId);
    } catch (err) {
      toast.error("Failed to toggle todo");
    }
  }

  async function handleDeleteTodo(todoId) {
    try {
      await deleteTodoMutation.mutateAsync(todoId);
      toast.success("Todo deleted");
    } catch (err) {
      toast.error("Failed to delete todo");
    }
  }

  const isOwner = (team) => {
    const ownerId = String(team?.ownerId?._id || team?.ownerId || "");
    const userId  = String(user?.id || user?._id || "");
    return ownerId === userId;
  };

  const isAdmin = (team) => {
    if (isOwner(team)) return true;
    const userId = String(user?.id || user?._id || "");
    return team?.members?.some(m => {
      const memberId = String(m.userId?._id || m.userId || "");
      return memberId === userId && (m.role === "admin" || m.role === "owner");
    });
  };

  // FEATURE: Safety check — if the selected team changes (or the user's role
  // changes) and the user is no longer an admin but is on the Logs tab,
  // fall back to the Members tab. This prevents a non-admin from seeing the
  // Logs tab content if they were an admin when they last opened it.
  useEffect(() => {
    if (selectedTeam && activeTab === "logs" && !isAdmin(selectedTeam)) {
      setActiveTab("members");
    }
  }, [selectedTeam, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  if (showTeamsSkeleton) return <div className="teams-page"><TeamGridSkeleton /></div>;

  return (
    <div className="teams-page">
      {isMobile && sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <div className={`sidebar-wrapper ${isMobile ? "mobile" : ""} ${sidebarOpen ? "open" : ""}`}>
        <Sidebar
          dark={dark} user={user} folders={localFolders} notes={notes.filter(n => !n.teamId)}
          onAllNotes={onGoNotes} onPinned={onGoNotes}
          onLogout={onLogout} toggleDark={toggleDark}
          onGoTeams={() => { setSidebarOpen(false); }}
          onGoTodos={() => { onGoTodos(); setSidebarOpen(false); }}
          onGoProfile={() => { if (onGoProfile) onGoProfile(); setSidebarOpen(false); }}
          onAddFolder={onAddFolder} onFolderDelete={onFolderDelete}
          onFolderOpen={(folderId) => { if (onFolderOpen) onFolderOpen(folderId, null); setSidebarOpen(false); }}
          activeSection="teams"
          teamId={null}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <div className="teams-main">
        {isMobile && (
          <div className="teams-mobile-header">
            <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>☰</button>
            <h1>Teams</h1>
            <button className="teams-btn-primary mobile-add-btn" onClick={() => setShowCreate(true)}>+</button>
          </div>
        )}

        <div className="teams-header">
          <h1 className={isMobile ? "mobile-hidden" : ""}>Teams</h1>
          {!isMobile && <button className="teams-btn-primary" onClick={() => setShowCreate(true)}>+ New Team</button>}
        </div>

        {error && <p className="teams-error">{error}</p>}

        {!selectedTeamId ? (
          <div className="teams-list">
            {teams.length === 0 && !teamsFetching ? (
              <div className="teams-empty">
                <div className="teams-empty-icon">👥</div>
                <h2>No teams yet</h2>
                <p>Create a team to collaborate with others on notes and projects.</p>
                <button className="teams-btn-primary" onClick={() => setShowCreate(true)}>+ Create Team</button>
              </div>
            ) : (
              <div className="teams-grid">
                {teams.map(team => (
                  <div key={team._id} className="team-card" onClick={() => selectTeam(team)}>
                    <div className="team-card-color" style={{ background: team.color || "#2383E2" }} />
                    <div className="team-card-body">
                      <h3>{team.name}</h3>
                      {team.description && <p>{team.description}</p>}
                      <div className="team-card-meta">
                        <span>{team.members?.length || 1} member{(team.members?.length || 1) !== 1 ? "s" : ""}</span>
                        <span>Owned by {team.ownerId?.name || "You"}</span>
                      </div>
                    </div>
                    {isOwner(team) && (
                      <button className="team-card-delete" onClick={e => { e.stopPropagation(); setDeleteTarget(team._id); }}>🗑</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : selectedTeam ? (
          <div className="team-detail">
            <button className="team-back-btn" onClick={() => { setSelectedTeamId(null); }}>← Back to Teams</button>

            <div className="team-detail-header">
              <div>
                <h2><span className="team-color-dot" style={{ background: selectedTeam.color || "#2383E2" }} />{selectedTeam.name}</h2>
                {selectedTeam.description && <p className="team-desc">{selectedTeam.description}</p>}
              </div>
              <div className="team-detail-actions">
                {isAdmin(selectedTeam) && (
                  <button
                    className="teams-btn-secondary"
                    onClick={() => setShowInvite(true)}
                    disabled={inviteMutation.isPending}
                  >
                    {inviteMutation.isPending ? "Sending..." : "Invite Member"}
                  </button>
                )}
                {isOwner(selectedTeam) && (
                  <button className="teams-btn-danger" onClick={() => setDeleteTarget(selectedTeam._id)}>Delete Team</button>
                )}
              </div>
            </div>

            {stats && (
              <div className="team-stats">
                <div className="team-stat-card"><span className="team-stat-num">{stats.memberCount}</span><span>Members</span></div>
                <div className="team-stat-card"><span className="team-stat-num">{stats.noteCount}</span><span>Notes</span></div>
                <div className="team-stat-card"><span className="team-stat-num">{selectedTeam.pendingInvites?.filter(i => !i.accepted).length || 0}</span><span>Pending Invites</span></div>
              </div>
            )}

            <div className="team-tabs">
              <button
                className={`team-tab ${activeTab === "members" ? "active" : ""}`}
                onClick={() => setActiveTab("members")}
              >Members</button>
              <button
                className={`team-tab ${activeTab === "notes" ? "active" : ""}`}
                onClick={() => setActiveTab("notes")}
              >Notes</button>
              <button
                className={`team-tab ${activeTab === "todos" ? "active" : ""}`}
                onClick={() => setActiveTab("todos")}
              >Todos</button>
              {/* FEATURE: Activity Logs tab — visible to admins (and owner) only. */}
              {isAdmin(selectedTeam) && (
                <button
                  className={`team-tab ${activeTab === "logs" ? "active" : ""}`}
                  onClick={() => setActiveTab("logs")}
                  title="View a log of all actions performed in this team"
                >Logs</button>
              )}
            </div>

            {activeTab === "members" && (
              <div className="team-members-section">
                <h3>Members</h3>
                <div className="team-members-list">
                  <div className="team-member-row owner">
                    <div className="team-member-avatar">{(selectedTeam.ownerId?.name || "O")[0].toUpperCase()}</div>
                    <div className="team-member-info">
                      <span className="team-member-name">{selectedTeam.ownerId?.name || "Owner"}</span>
                      <span className="team-member-email">{selectedTeam.ownerId?.email}</span>
                    </div>
                    <span className="team-role-badge owner-badge">Owner</span>
                  </div>

                  {selectedTeam.members?.filter(m => {
                    const mid = String(m.userId?._id || m.userId);
                    return mid !== String(selectedTeam.ownerId?._id || selectedTeam.ownerId);
                  }).map(m => {
                    // FIX #3 (v2): Per-member status badge & dropdown removed.
                    // Only role (admin/member) is shown now.
                    // FIX: Crown emoji removed from Admin badge per request —
                    // the role name alone is enough; the badge color already
                    // distinguishes admin (accent color) from member (gray).
                    const memberId = String(m.userId?._id || m.userId);
                    const isMe = memberId === String(user?.id || user?._id);
                    return (
                    <div key={memberId} className="team-member-row">
                      <div className="team-member-avatar">{(m.userId?.name || "M")[0].toUpperCase()}</div>
                      <div className="team-member-info">
                        <span className="team-member-name">{m.userId?.name || "Member"}</span>
                        <span className="team-member-email">{m.userId?.email}</span>
                      </div>
                      {m.role === "admin" ? (
                        <span className="team-role-badge admin-badge">Admin</span>
                      ) : (
                        <span className="team-role-badge member-badge">Member</span>
                      )}
                      {isAdmin(selectedTeam) && !isMe && (
                        <div className="team-member-actions">
                          {/* FIX: Single toggle button — owner can flip a
                           * member's role between admin ↔ member as many
                           * times as they want. The button label reflects
                           * the action that WILL happen on click. */}
                          {isOwner(selectedTeam) && (
                            <button
                              className="team-action-btn"
                              onClick={() => handleToggleRole(memberId, m.role)}
                              disabled={roleMutation.isPending}
                              title={m.role === "admin" ? "Demote this admin back to Member" : "Promote this member to Admin"}
                            >
                              {m.role === "admin" ? "Remove Admin" : "Make Admin"}
                            </button>
                          )}
                          <button className="team-action-btn danger" onClick={() => handleRemoveMember(memberId)} disabled={removeMutation.isPending}>Remove</button>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>

                {selectedTeam.pendingInvites?.filter(i => !i.accepted).length > 0 && (
                  <div className="team-invites-section">
                    <h3>Pending Invites</h3>
                    {selectedTeam.pendingInvites.filter(i => !i.accepted).map((inv, idx) => (
                      <div key={idx} className="team-invite-row">
                        <div className="team-invite-info">
                          <span className="team-invite-email">{inv.email}</span>
                          <span className="team-role-badge member-badge">{inv.role}</span>
                          <span className="team-invite-expires">Expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
                        </div>
                        {isAdmin(selectedTeam) && (
                          <button
                            className="team-action-btn danger"
                            onClick={() => handleCancelInvite(inv.email)}
                            disabled={cancelMutation.isPending}
                          >Cancel</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "notes" && (
              <div className="team-notes-section">
                {/* COMBINED FIX #4b: Redesigned Team Notes header.
                    - "New Folder" = compact outlined button with folder icon
                    - "New Note" = compact filled button with + icon
                    - Both buttons are smaller (px-3 py-1.5) so they fit
                      comfortably on mobile screens side-by-side. */}
                <div className="team-notes-header team-notes-header-compact">
                  <h3>Team Notes</h3>
                  <div className="team-notes-actions">
                    <button
                      className="team-btn-outlined"
                      onClick={() => setShowCreateFolder(true)}
                      title="Create a new folder"
                    >
                      <span aria-hidden>📁</span>
                      <span>New Folder</span>
                    </button>
                    <button
                      className="team-btn-filled"
                      onClick={handleCreateTeamNote}
                      disabled={creatingNote}
                      title="Create a new team note"
                    >
                      <span aria-hidden>+</span>
                      <span>{creatingNote ? "Creating…" : "New Note"}</span>
                    </button>
                  </div>
                </div>

                {/* FIX: Team Folders — only shown here, NOT in sidebar to avoid duplicates */}
                {teamFolders.length > 0 && (
                  <div className="team-folders-section">
                    <p className="team-folders-label">Folders</p>
                    {/* COMBINED FIX #4b: Folder cards now use a compact
                        horizontal row layout (icon + name + note count on
                        one line) instead of a 3-line card. Saves vertical
                        space and looks cleaner on mobile. */}
                    <div className="team-folders-list">
                      {teamFolders.map(f => (
                        <div
                          key={f._id}
                          className="team-folder-row"
                          onClick={() => { if (onFolderOpen) onFolderOpen(f._id, selectedTeamId); }}
                          title={`Open folder: ${f.name}`}
                        >
                          <span className="team-folder-icon" aria-hidden>📁</span>
                          <div className="team-folder-info">
                            <p className="team-folder-name">{f.name}</p>
                            <p className="team-folder-count">{f.noteCount || 0} note{(f.noteCount || 0) !== 1 ? "s" : ""}</p>
                          </div>
                          <span className="team-folder-arrow" aria-hidden>›</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {teamNotesFetching && teamNotes.length === 0 ? (
                  <div className="teams-empty">
                    <p>Loading notes...</p>
                  </div>
                ) : teamNotes.length === 0 ? (
                  <div className="teams-empty">
                    <div className="teams-empty-icon">📄</div>
                    <h2>No team notes yet</h2>
                    <p>Create notes that are shared with all team members.</p>
                    <button className="teams-btn-primary" onClick={handleCreateTeamNote}>+ Create Team Note</button>
                  </div>
                ) : (
                  <div className="team-notes-grid">
                    {teamNotes.map(note => (
                      <div
                        key={note._id}
                        className="team-note-card"
                        onClick={() => { if (onOpenNote) onOpenNote(note._id); }}
                      >
                        <div className="team-note-title">{note.title || "Untitled"}</div>
                        <div className="team-note-preview">{note.body || "No content yet"}</div>
                        <div className="team-note-meta">
                          <span className="team-note-author">{note.userId?.name || "You"}</span>
                          <span className="team-note-time">{new Date(note.updatedAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "todos" && (
              <div className="team-todos-section">
                <div className="team-notes-header">
                  <h3>Team Todos</h3>
                  <button className="teams-btn-primary" onClick={() => setShowCreateTodo(true)}>+ New Team Todo</button>
                </div>

                {teamTodoStats && (
                  <div className="todos-stats" style={{ marginBottom: 16 }}>
                    <div className="todo-stat-card">
                      <span className="todo-stat-num">{teamTodoStats.total || 0}</span>
                      <span>Total</span>
                    </div>
                    <div className="todo-stat-card completed">
                      <span className="todo-stat-num">{teamTodoStats.done || 0}</span>
                      <span>Completed</span>
                    </div>
                    <div className="todo-stat-card active">
                      <span className="todo-stat-num">{teamTodoStats.pending || 0}</span>
                      <span>Active</span>
                    </div>
                    <div className="todo-stat-card overdue">
                      <span className="todo-stat-num">{teamTodoStats.overdue || 0}</span>
                      <span>Overdue</span>
                    </div>
                  </div>
                )}

                {teamTodosFetching && teamTodos.length === 0 ? (
                  <div className="teams-empty"><p>Loading todos...</p></div>
                ) : teamTodos.length === 0 ? (
                  <div className="teams-empty">
                    <div className="teams-empty-icon">✅</div>
                    <h2>No team todos yet</h2>
                    <p>Create todos that are shared with all team members.</p>
                    <button className="teams-btn-primary" onClick={() => setShowCreateTodo(true)}>+ Create Team Todo</button>
                  </div>
                ) : (
                  <div className="todos-list">
                    {teamTodos.map(todo => {
                      const priorityColor = (p) => {
                        switch (p) {
                          case "high": return { bg: "#FFF1F2", color: "#9F1239", darkBg: "#4c0519", darkColor: "#fda4af" };
                          case "medium": return { bg: "#FFF7ED", color: "#9A3412", darkBg: "#431407", darkColor: "#fdba74" };
                          case "low": return { bg: "#F0FDF4", color: "#166534", darkBg: "#14532d", darkColor: "#86efac" };
                          default: return { bg: "#F5F5F5", color: "#666", darkBg: "#333", darkColor: "#aaa" };
                        }
                      };
                      const pc = priorityColor(todo.priority);
                      return (
                        <div key={todo._id} className={`todo-item ${todo.isDone ? "completed" : ""}`}>
                          <button
                            className={`todo-checkbox ${todo.isDone ? "checked" : ""}`}
                            onClick={() => handleToggleTodo(todo._id)}
                            disabled={toggleTodoMutation.isPending}
                          >
                            {todo.isDone && "✓"}
                          </button>
                          <div className="todo-content">
                            <div className="todo-title-row">
                              <span className={`todo-title ${todo.isDone ? "done" : ""}`}>{todo.title}</span>
                              <span
                                className="todo-priority-badge"
                                style={dark ? { background: pc.darkBg, color: pc.darkColor } : { background: pc.bg, color: pc.color }}
                              >
                                {todo.priority}
                              </span>
                            </div>
                            {todo.description && <p className="todo-description">{todo.description}</p>}
                            <div className="todo-meta">
                              {todo.dueDate && (
                                <span className={`todo-due ${new Date(todo.dueDate) < new Date() && !todo.isDone ? "overdue" : ""}`}>
                                  Due: {new Date(todo.dueDate).toLocaleDateString()}
                                </span>
                              )}
                              {todo.assignedTo?.name && (
                                <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                                  Assigned: {todo.assignedTo.name}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="todo-actions">
                            <button className="todo-action-btn danger" onClick={() => handleDeleteTodo(todo._id)}>🗑</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* FEATURE: Activity Logs tab — admin-only. Lists every action
                performed inside the team (note created/edited/deleted, todo
                toggled, member invited/removed/role-changed, folder created/
                deleted, etc.) with actor name, action description, and a
                relative + absolute timestamp. */}
            {activeTab === "logs" && isAdmin(selectedTeam) && (
              <div className="team-logs-section">
                <div className="team-notes-header">
                  <h3>Activity Logs</h3>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    Audit trail of every action in this team
                  </span>
                </div>

                {teamLogsFetching && teamLogs.length === 0 ? (
                  <div className="teams-empty"><p>Loading logs…</p></div>
                ) : teamLogs.length === 0 ? (
                  <div className="teams-empty">
                    <div className="teams-empty-icon">📋</div>
                    <h2>No activity yet</h2>
                    <p>Actions performed by team members will appear here.</p>
                  </div>
                ) : (
                  <div className="team-logs-list">
                    {teamLogs.map(log => (
                      <LogRow key={log._id} log={log} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Create Team Modal */}
      {showCreate && (
        <Modal
          title="Create New Team"
          message=""
          onConfirm={handleCreateTeam}
          onCancel={() => { setShowCreate(false); setError(""); }}
          confirmLabel="Create"
        >
          <div className="team-form">
            <label>Team Name *</label>
            <input value={newTeam.name} onChange={e => setNewTeam({ ...newTeam, name: e.target.value })} placeholder="e.g., Design Team" />
            <label>Description</label>
            <input value={newTeam.description} onChange={e => setNewTeam({ ...newTeam, description: e.target.value })} placeholder="What's this team about?" />
            <label>Color</label>
            <input type="color" value={newTeam.color} onChange={e => setNewTeam({ ...newTeam, color: e.target.value })} />
          </div>
        </Modal>
      )}

      {/* Invite Member Modal */}
      {showInvite && (
        <Modal
          title="Invite Team Member"
          message=""
          onConfirm={handleInvite}
          onCancel={() => { setShowInvite(false); setError(""); }}
          confirmLabel={inviteMutation.isPending ? "Sending..." : "Send Invite"}
        >
          <div className="team-form">
            <label>Email Address *</label>
            <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="colleague@example.com" type="email" />
            <label>Role</label>
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
        </Modal>
      )}

      {/* Create Team Folder Modal */}
      {showCreateFolder && (
        <Modal
          title="Create Team Folder"
          message=""
          onConfirm={handleCreateTeamFolder}
          onCancel={() => { setShowCreateFolder(false); setNewFolderName(""); }}
          confirmLabel="Create"
        >
          <div className="team-form">
            <label>Folder Name *</label>
            <input
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              placeholder="e.g., Project Docs"
              onKeyDown={e => { if (e.key === "Enter") handleCreateTeamFolder(); }}
              autoFocus
            />
          </div>
        </Modal>
      )}

      {/* Create Team Todo Modal */}
      {showCreateTodo && (
        <Modal
          title="Create Team Todo"
          message=""
          onConfirm={handleCreateTeamTodo}
          onCancel={() => { setShowCreateTodo(false); setNewTodo({ title: "", description: "", priority: "medium", dueDate: "" }); setTodoError(""); }}
          confirmLabel={createTodoMutation.isPending ? "Creating..." : "Create"}
        >
          <div className="todo-form">
            {todoError && <p className="auth-error" style={{ marginBottom: 8 }}>{todoError}</p>}
            <label>Title *</label>
            <input value={newTodo.title} onChange={e => setNewTodo({ ...newTodo, title: e.target.value })} placeholder="What needs to be done?" />
            <label>Description</label>
            <textarea value={newTodo.description} onChange={e => setNewTodo({ ...newTodo, description: e.target.value })} placeholder="Additional details..." rows={3} />
            <label>Priority</label>
            <select value={newTodo.priority} onChange={e => setNewTodo({ ...newTodo, priority: e.target.value })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <label>Due Date</label>
            <input type="date" value={newTodo.dueDate} onChange={e => setNewTodo({ ...newTodo, dueDate: e.target.value })} />
          </div>
        </Modal>
      )}

      {/* Delete Team Modal */}
      {deleteTarget && (
        <Modal
          title="Delete this team?"
          message="The team will be archived. Team notes will become personal notes of their original authors. This cannot be undone."
          onConfirm={() => handleDeleteTeam(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
          confirmLabel="Delete"
          variant="danger"
        />
      )}

      {/* COMBINED FIX #4a: Bottom navigation bar removed. */}
    </div>
  );
}

// ─── FEATURE: LogRow — renders a single Activity Log entry ───────────────────
// Each entry shows: icon (by action type), actor name, action description,
// and timestamp (relative + absolute on hover).
//
// BUG #1 FIX: The previous version used inline color literals like
// `dark ? "#e2e8f0" : "#1a202c"` everywhere. While that *did* respond to the
// `dark` prop, the colors were inconsistent with the rest of the app (which
// uses CSS variables like `var(--text-primary)`), and the container card
// (`.team-logs-list`) had a separate bug where its background was always
// white (see teams.css). Together this made the Logs page look "stuck in
// light mode". We now lean on CSS variables for text colors and only keep
// the action-tinted badge color as an inline style (since it varies per row).
function LogRow({ log }) {
  const iconFor = (action) => {
    if (!action) return "•";
    if (action.startsWith("note."))    return "📝";
    if (action.startsWith("todo."))    return "✅";
    if (action.startsWith("folder."))  return "📁";
    if (action.startsWith("member."))  return "👥";
    return "•";
  };

  const accentFor = (action) => {
    if (!action) return "#64748b";
    if (action.endsWith(".create") || action === "member.join")   return "#16a34a"; // green
    if (action.endsWith(".delete") || action === "member.remove") return "#dc2626"; // red
    if (action === "todo.toggle" || action.endsWith(".pin") || action.endsWith(".unpin")) return "#2563eb"; // blue
    if (action === "member.role" || action === "member.invite")   return "#d97706"; // amber
    if (action.endsWith(".update"))                                return "#7c3aed"; // violet
    return "#64748b";
  };

  const time = new Date(log.createdAt);
  const relative = (() => {
    const diff = Date.now() - time.getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)}d ago`;
    return time.toLocaleDateString();
  })();
  const accent = accentFor(log.action);

  return (
    <div className="team-log-row" style={{
      display: "flex", alignItems: "flex-start", gap: 12,
      padding: "12px 14px",
      borderBottom: "1px solid var(--border)",
    }}>
      <div style={{
        flexShrink: 0, width: 36, height: 36, borderRadius: 8,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18, background: "var(--hover-bg)",
      }}>{iconFor(log.action)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
            {log.actorName || "Unknown user"}
          </span>
          <span style={{
            fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
            color: accent, background: `${accent}22`, padding: "2px 6px", borderRadius: 4,
          }}>{log.action}</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
          {log.description || log.action}
        </div>
      </div>
      <div style={{
        flexShrink: 0, fontSize: 12, color: "var(--text-tertiary)", textAlign: "right",
      }} title={time.toLocaleString()}>
        {relative}
      </div>
    </div>
  );
}
