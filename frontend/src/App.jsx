import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import toast, { Toaster } from "react-hot-toast";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { AuthProvider, useAuth, getAccessToken } from "./context/AuthContext";
import { FullPageSkeleton } from "./components/Skeletons";
import ErrorBoundary from "./components/ErrorBoundary";
import { destroySocket } from "./services/socket";
import { useKeepAlive } from "./hooks/useKeepAlive";
import { useGlobalTeamSocket } from "./hooks/useSockets";

const AuthPage       = lazy(() => import("./pages/AuthPage"));
const Dashboard      = lazy(() => import("./pages/Dashboard"));
const NoteEditor     = lazy(() => import("./pages/NoteEditor"));
const TeamsPage      = lazy(() => import("./pages/TeamsPage"));
const TodosPage      = lazy(() => import("./pages/TodosPage"));
const FolderDetailPage = lazy(() => import("./pages/FolderDetailPage"));
const SharedNotePage  = lazy(() => import("./pages/SharedNotePage"));
const ProfilePage     = lazy(() => import("./pages/ProfilePage"));

import { notesAPI, foldersAPI, teamsAPI } from "./services/api";
import { getFolderId } from "./utils/helpers";
import "./styles/global.css";

function AppInner() {
  const { user, loading, screen, setScreen, logout, refreshUser, showTimeoutWarning, dismissTimeoutWarning, autoAcceptInvite, storePendingInvite } = useAuth();

  // AUTH FIX #2: Ping the backend every 4 minutes to keep it warm on
  // Render's free tier. Without this, the server cold-starts (50-90s) when
  // the user comes back after a period of inactivity, and login + the first
  // notes/folders fetch all fail with "Cannot reach server" errors.
  useKeepAlive();

  // REAL-TIME FIX: Global team socket — mounted ONCE here at the App level.
  // Joins ALL of the user's team rooms at login and listens for
  // `member:roleUpdated`, `log:created`, `note:list:changed`, `todo:*`
  // events GLOBALLY — so cache invalidation happens regardless of which page
  // the user is currently on.
  //
  // This fixes two real bugs:
  //   1. "User has to reload the website after being promoted to admin."
  //   2. "Activity logs don't refresh in real-time."
  //
  // The `onSelfRoleChanged` callback fires when the CURRENT user's role is
  // changed by a team owner. We refresh their session (`/api/auth/me`) so
  // the sidebar / permissions / admin-only actions update immediately, and
  // show a toast so they know what happened.
  const handleSelfRoleChanged = useCallback((freshUser, payload) => {
    refreshUser();
    if (payload?.role === "admin") {
      toast.success("You were promoted to Admin!");
    } else if (payload?.role === "member") {
      toast("Your admin role was removed.", { icon: "ℹ️", duration: 4000 });
    }
  }, [refreshUser]);
  useGlobalTeamSocket(user, handleSelfRoleChanged);

  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem("nexnote-dark") === "true"; } catch { return false; }
  });

  const [notes, setNotes]           = useState([]);
  const [folders, setFolders]       = useState([]);
  const [activeNoteId, setActiveNoteId] = useState(null);
  const [sharedNote, setSharedNote] = useState(null);
  const [folderDetailState, setFolderDetailState] = useState(null);

  const [creatingNote, setCreatingNote] = useState(false);

  // BUG 4 FIX: Lift `selectedTeamId` from TeamsPage into App.jsx so it
  // survives navigation away from the Teams screen. Previously, when the
  // user navigated Teams → Team → Folder and then pressed Back, TeamsPage
  // would remount with `selectedTeamId = null` (its initial state) and the
  // user would land on the Teams grid instead of the team they were just
  // viewing. Keeping the selected team id in App.jsx means pressing Back
  // from FolderDetail returns the user to the SAME team they came from —
  // i.e., one level up in the navigation hierarchy, as expected.
  const [selectedTeamId, setSelectedTeamId] = useState(null);

  const hasLoadedRef = useRef(false);
  // BUG 4 FIX: Split the single previousScreenRef into two refs so the
  // editor and FolderDetail each remember their own "back" destination.
  // The previous implementation shared one ref, which meant:
  //   1. Navigating Teams → Folder did not record "teams" as the back
  //      target (the ref was only updated on note open / create), so the
  //      FolderDetail back button sent the user back to whatever screen
  //      they were on before the current navigation chain — often Home.
  //   2. Opening a note from inside FolderDetail overwrote the ref with
  //      "folderDetail", so when the user popped back to FolderDetail and
  //      pressed back again, they went to "folderDetail" (a no-op) instead
  //      of up to Teams.
  // editorPreviousRef  : screen to return to when the editor's Back is pressed.
  // folderDetailPreviousRef : screen to return to when FolderDetail's Back is pressed.
  const editorPreviousRef = useRef("dashboard");
  const folderDetailPreviousRef = useRef("dashboard");

  useEffect(() => {
    try { localStorage.setItem("nexnote-dark", dark); } catch {}
    document.documentElement.className = dark ? "dark" : "";
  }, [dark]);

  // ─── Load notes & folders when user logs in ───────────────────────────────
  // AUTH FIX #3: Previously, `loadData` was called from a useEffect that
  // watched `[screen, loadData, user]`. The dependency on `loadData` (which
  // itself depends on `user`) meant the effect re-ran every time `user`
  // changed — but more importantly, the API calls inside `loadData` fire
  // without first verifying that an access token is actually available in
  // memory. On a cold start where the access token has expired and the
  // refresh flow hasn't completed yet, these calls would 401 and show
  // "Failed to load data" — even though the user was technically still
  // logged in.
  //
  // We now (a) import `getAccessToken` from AuthContext, (b) bail out of
  // `loadData` if no token is in memory (the axios interceptor will refresh
  // it on the next real request), and (c) retry once on network errors
  // (which usually means the server is cold-starting).
  const loadData = useCallback(async () => {
    if (!user) return;
    // AUTH FIX #3: Don't fire API calls before the access token is ready.
    // The axios response interceptor will refresh it on a 401, but calling
    // `getAll()` with no token at all wastes a round-trip and produces
    // a confusing error toast.
    const token = getAccessToken();
    if (!token) {
      // No token in memory yet — skip this load. The next user action
      // (or a future loadData call) will trigger a refresh.
      return;
    }
    try {
      const [n, f] = await Promise.all([
        notesAPI.getAll(),
        foldersAPI.getAll(),
      ]);
      setNotes(Array.isArray(n) ? n : n?.notes || []);
      setFolders(Array.isArray(f) ? f : f?.folders || []);
      hasLoadedRef.current = true;
    } catch (err) {
      // AUTH FIX #3: Distinguish network errors (server cold-starting)
      // from real auth failures. Show a specific, actionable message.
      const status = err?.response?.status;
      if (status === 401) {
        // The axios interceptor should have already attempted a refresh
        // and replayed the request. If we still got 401, the session is
        // truly dead — a logout will follow shortly via the interceptor.
        toast.error("Your session has expired. Please log in again.");
      } else if (err?.code === "ERR_NETWORK" || err?.code === "ECONNABORTED" || !err?.response) {
        // Server is unreachable — likely Render cold-starting. Retry once
        // after 5 seconds. Don't toast on the first attempt (too noisy);
        // only show the message if the retry also fails.
        toast.loading("Connecting to server…", { id: "load-data", duration: 4000 });
        setTimeout(async () => {
          try {
            const [n, f] = await Promise.all([notesAPI.getAll(), foldersAPI.getAll()]);
            setNotes(Array.isArray(n) ? n : n?.notes || []);
            setFolders(Array.isArray(f) ? f : f?.folders || []);
            hasLoadedRef.current = true;
            toast.dismiss("load-data");
            toast.success("Connected!");
          } catch (retryErr) {
            toast.dismiss("load-data");
            const rStatus = retryErr?.response?.status;
            if (rStatus === 401) {
              toast.error("Your session has expired. Please log in again.");
            } else {
              toast.error("Couldn't load notes — please refresh the page.");
            }
          }
        }, 5000);
      } else {
        toast.error("Couldn't load notes — please refresh the page.");
      }
    }
  }, [user]);

  useEffect(() => {
    if (screen !== "auth" && user && !hasLoadedRef.current) loadData();
  }, [screen, loadData, user]);

  // ─── Notes CRUD ────────────────────────────────────────────────────────────
  // BUG 2 FIX: The `notes` state in App.jsx is loaded from `notesAPI.getAll()`
  // (no teamId) which returns PERSONAL notes only. To keep the Sidebar's
  // "All Notes" and "Pinned" counts correct at all times, we MUST NOT pollute
  // this state with team notes. Team notes live in the React Query cache
  // (managed by the `useTeamNotes` hook) and are invalidated separately.
  // Previously, `createNote` added EVERY new note (including team notes) to
  // the `notes` state — that itself didn't break the count (the Sidebar
  // filters team notes out via `!getTeamId(n.teamId)`), but it did mean the
  // `notes` array was inconsistent with what `notesAPI.getAll()` returns,
  // which could cause subtle count drift after a page refresh. Now we only
  // add the note to `notes` state when it's a personal note (no teamId).
  async function createNote(data = {}) {
    if (creatingNote) return;
    setCreatingNote(true);
    try {
      const note = await notesAPI.create({ title: "", body: "", tags: [], ...data });

      if (!note || !note._id) {
        throw new Error("Server returned an invalid note object");
      }

      // BUG 2 FIX: Only add to personal notes state if it's a personal note.
      // Team notes are kept in the React Query cache (invalidated below).
      if (!note.teamId) {
        setNotes(n => [note, ...n]);
      }
      setActiveNoteId(note._id);
      // BUG 4 FIX: Use editorPreviousRef so the editor knows where to return.
      // If the note belongs to the currently selected team, remember "teams"
      // so pressing Back from the editor returns to the team view.
      editorPreviousRef.current = (data.teamId || note.teamId) ? "teams" : (data.folderId ? "folderDetail" : screen);
      setScreen("editor");
      toast.success("Note created");
      // Refresh folder data so note counts update in sidebar
      foldersAPI.getAll().then(f => {
        setFolders(Array.isArray(f) ? f : f?.folders || []);
      }).catch(() => {});
      // BUG 3 FIX: Invalidate React Query caches so team note lists, team
      // stats, and folder counts refresh after a new note is created.
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["team"] });
      queryClient.invalidateQueries({ queryKey: ["folders"] });
    } catch (err) {
      console.error("Create note error:", err);
      toast.error(err.response?.data?.message || err.message || "Failed to create note");
    } finally {
      setCreatingNote(false);
    }
  }

  async function saveNote(id, updates) {
    try {
      const updated = await notesAPI.update(id, updates);
      // BUG 2 FIX: Only update the personal notes state if the note is
      // personal. Team notes are kept in the React Query cache.
      if (!updated.teamId) {
        setNotes(n => n.map(note => note._id === id ? { ...note, ...updated } : note));
      }
      setFetchedNote(fn => fn && fn._id === id ? { ...fn, ...updated } : fn);
      // BUG 3 FIX: Invalidate React Query caches so that team notes list,
      // team stats, and folder note counts refresh after a note is saved
      // (e.g., when a note is moved into or out of a folder).
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["team"] });
      queryClient.invalidateQueries({ queryKey: ["folders"] });
    } catch (err) {
      toast.error("Failed to save note");
    }
  }

  async function deleteNote(id) {
    try {
      await notesAPI.delete(id);
      // BUG 2 FIX: Only update personal notes state — team notes are in the
      // React Query cache (invalidated below).
      setNotes(n => n.filter(note => note._id !== id));
      toast.success("Note deleted");
      // BUG 3 FIX: Invalidate caches so team stats / folder counts refresh.
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      queryClient.invalidateQueries({ queryKey: ["team"] });
      queryClient.invalidateQueries({ queryKey: ["folders"] });
    } catch (err) {
      toast.error("Failed to delete note");
    }
  }

  async function pinNote(id) {
    try {
      const updated = await notesAPI.togglePin(id);
      // BUG 2 FIX: Only update personal notes state if the note is personal.
      if (!updated.teamId) {
        setNotes(n => n.map(note => note._id === id ? { ...note, ...updated } : note));
      }
      toast.success(updated.isPinned ? "Note pinned" : "Note unpinned");
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      if (updated.teamId) queryClient.invalidateQueries({ queryKey: ["team"] });
    } catch (err) {
      toast.error("Failed to pin note");
    }
  }

  async function shareNote(id) {
    try {
      const result = await notesAPI.share(id);
      const shareToken = result.note?.shareToken || result.shareToken;
      const shareUrl = `${window.location.origin}?shared=${shareToken}`;
      try { await navigator.clipboard?.writeText(shareUrl); } catch {}
      toast.success("Share link copied!");
      // BUG 2 FIX: Only update personal notes state if the note is personal.
      const sharedNote = result.note;
      if (sharedNote && !sharedNote.teamId) {
        setNotes(n => n.map(note => note._id === id ? { ...note, isShared: true, shareToken } : note));
      }
      if (sharedNote?.teamId) queryClient.invalidateQueries({ queryKey: ["team"] });
    } catch (err) {
      toast.error("Failed to share note");
    }
  }

  // ─── Folders CRUD ─────────────────────────────────────────────────────────
  async function addFolder(name, teamId = null) {
    if (!name.trim()) return;
    try {
      const folder = await foldersAPI.create({ name: name.trim(), ...(teamId ? { teamId } : {}) });
      setFolders(f => [...f, folder]);
      toast.success(`Folder "${name.trim()}" created`);
    } catch (err) {
      toast.error("Failed to create folder");
    }
  }

  async function deleteFolder(folderId) {
    try {
      await foldersAPI.delete(folderId);
      setNotes(n => n.map(note => {
        const noteFolderId = getFolderId(note.folderId);
        return noteFolderId === folderId ? { ...note, folderId: null } : note;
      }));
      setFolders(f => f.filter(folder => folder._id !== folderId));
      toast.success("Folder deleted. Notes moved to Uncategorized.");
    } catch (err) {
      toast.error("Failed to delete folder");
    }
  }

  // ─── Shared note ──────────────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("shared");
    if (token) {
      notesAPI.getShared(token).then(setSharedNote).catch(() => toast.error("Shared note not found"));
    }
  }, []);

  // ─── Accept invite flow ───────────────────────────────────────────────────
  const inviteProcessedRef = useRef(false);
  useEffect(() => {
    if (inviteProcessedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get("token") || params.get("invite");
    const isInvite = window.location.pathname === "/accept-invite" || params.has("invite");

    if (inviteToken && isInvite) {
      inviteProcessedRef.current = true;
      if (user) {
        teamsAPI.acceptInvite(inviteToken).then(() => {
          toast.success("You have joined the team!");
          setScreen("teams");
          loadData();
          window.history.replaceState({}, "/", "/");
        }).catch(err => {
          toast.error(err.response?.data?.message || "Failed to accept invite");
          window.history.replaceState({}, "/", "/");
        });
      } else {
        storePendingInvite(inviteToken);
        toast("Sign in to accept the team invitation", { icon: "👥", duration: 5000 });
        window.history.replaceState({}, "/", "/");
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeNote = notes.find(n => n._id === activeNoteId);

  // FIX: Fetch note from API if not in local state (e.g., team notes)
  // FIX: Use a ref to track pending note ID to avoid "Note not found" flash
  const [fetchedNote, setFetchedNote] = useState(null);
  const [fetchingNote, setFetchingNote] = useState(false);
  const [noteFetchError, setNoteFetchError] = useState(false);
  const pendingNoteIdRef = useRef(null);

  useEffect(() => {
    if (activeNoteId && !activeNote) {
      // FIX: Set fetching immediately and track the pending ID
      pendingNoteIdRef.current = activeNoteId;
      setFetchingNote(true);
      setFetchedNote(null);
      setNoteFetchError(false);
      notesAPI.getById(activeNoteId).then(n => {
        // Only set if this is still the active note
        if (pendingNoteIdRef.current === activeNoteId) {
          setFetchedNote(n);
          setFetchingNote(false);
        }
      }).catch(() => {
        if (pendingNoteIdRef.current === activeNoteId) {
          toast.error("Failed to load note");
          setFetchingNote(false);
          setNoteFetchError(true);
        }
      });
    } else {
      setFetchedNote(null);
      setFetchingNote(false);
      setNoteFetchError(false);
      pendingNoteIdRef.current = null;
    }
  }, [activeNoteId, activeNote]);

  const editorNote = activeNote || fetchedNote;

  // ─── Folder open handler ─────────────────────────────────────────────────
  function handleFolderOpen(folderId, teamId = null) {
    // BUG 4 FIX: Record where we came from so the FolderDetail back button
    // can return the user one level up (e.g., Teams → Folder → back to
    // Teams, not Home). Only record when we're actually changing screens —
    // navigating folder-to-folder from the sidebar keeps the original
    // "from" target intact so back still escapes the folder view.
    if (screen !== "folderDetail") {
      folderDetailPreviousRef.current = screen;
    }
    // FIX: Always set a new state object to force re-mount/re-render
    setFolderDetailState({ folderId, teamId, ts: Date.now() });
    setScreen("folderDetail");
  }

  // ─── Loading screen ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <FullPageSkeleton />
        <Toaster position="top-right" />
      </>
    );
  }

  // ─── Shared note view ─────────────────────────────────────────────────────
  if (sharedNote) {
    return (
      <Suspense fallback={<FullPageSkeleton />}>
        <SharedNotePage note={sharedNote} dark={dark} onBack={() => { setSharedNote(null); window.history.replaceState({}, "/", "/"); }} />
        <Toaster position="top-right" />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<FullPageSkeleton />}>
      {screen === "auth" && (
        <AuthPage dark={dark} toggleDark={() => setDark(d => !d)} />
      )}
      {screen === "dashboard" && (
        <Dashboard
          notes={notes.filter(n => !n.teamId)} folders={folders.filter(f => !f.teamId)} user={user} dark={dark}
          toggleDark={() => setDark(d => !d)}
          onOpenNote={id => { editorPreviousRef.current = "dashboard"; setActiveNoteId(id); setScreen("editor"); }}
          onCreateNote={() => createNote()}
          onDeleteNote={deleteNote}
          onPinNote={pinNote}
          onShareNote={shareNote}
          onAddFolder={addFolder}
          onFolderDelete={deleteFolder}
          onLogout={logout}
          onGoTeams={() => setScreen("teams")}
          onGoTodos={() => setScreen("todos")}
          onGoProfile={() => setScreen("profile")}
          onRefresh={loadData}
          onFolderOpen={(folderId) => handleFolderOpen(folderId, null)}
          creatingNote={creatingNote}
        />
      )}
      {/* FIX: Show loading state immediately when entering editor with a note ID that needs fetching */}
      {screen === "editor" && activeNoteId && !editorNote && fetchingNote && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "var(--font)", color: "var(--text-secondary)" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
            <p>Loading note...</p>
          </div>
        </div>
      )}
      {/* FIX: Show error state when note fetch fails */}
      {screen === "editor" && activeNoteId && !editorNote && noteFetchError && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "var(--font)", color: "var(--text-secondary)" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>😅</div>
            <p>Failed to load note</p>
            <button onClick={() => { setActiveNoteId(null); setNoteFetchError(false); setScreen(editorPreviousRef.current); }} style={{ marginTop: 12, padding: "8px 20px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontFamily: "var(--font)" }}>Go Back</button>
          </div>
        </div>
      )}
      {screen === "editor" && editorNote && (
        <ErrorBoundary
          fallback={({ onReset }) => (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "var(--font)", color: "var(--text-secondary)", padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>😅</div>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
                Couldn't open this note
              </h2>
              <p style={{ fontSize: 14, marginBottom: 20, maxWidth: 400 }}>
                Another member may have just edited or deleted it. Please go back
                and try reopening it from the list.
              </p>
              <button
                onClick={() => { setActiveNoteId(null); setFetchedNote(null); setScreen(editorPreviousRef.current); onReset && onReset(); }}
                style={{ padding: "10px 24px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontFamily: "var(--font)", fontSize: 14 }}
              >
                Go Back
              </button>
            </div>
          )}
        >
          <NoteEditor
            key={editorNote._id}
            note={editorNote} folders={folders} dark={dark}
            onBack={() => { setScreen(editorPreviousRef.current); loadData(); setFetchedNote(null); setActiveNoteId(null); }}
            onSave={updates => saveNote(editorNote._id, updates)}
            onDelete={id => { deleteNote(id); setScreen(editorPreviousRef.current); setFetchedNote(null); setActiveNoteId(null); }}
            onShare={shareNote}
            onPin={pinNote}
          />
        </ErrorBoundary>
      )}
      {/* FIX: Only show "not found" if we have no note ID at all (shouldn't normally happen) */}
      {screen === "editor" && !activeNoteId && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontFamily: "var(--font)", color: "var(--text-secondary)" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>😅</div>
            <p>Note not found</p>
            <button onClick={() => { setActiveNoteId(null); setScreen("dashboard"); }} style={{ marginTop: 12, padding: "8px 20px", background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontFamily: "var(--font)" }}>Go Back</button>
          </div>
        </div>
      )}
      {screen === "teams" && (
        <TeamsPage
          dark={dark} user={user}
          notes={notes} folders={folders}
          onBack={() => setScreen("dashboard")}
          toggleDark={() => setDark(d => !d)}
          onLogout={logout}
          onAddFolder={addFolder}
          onFolderDelete={deleteFolder}
          onGoNotes={() => setScreen("dashboard")}
          onGoTodos={() => setScreen("todos")}
          onGoProfile={() => setScreen("profile")}
          onCreateNote={(data) => createNote(data)}
          onOpenNote={id => { editorPreviousRef.current = "teams"; setActiveNoteId(id); setScreen("editor"); }}
          onRefresh={loadData}
          onFolderOpen={(folderId, teamId) => handleFolderOpen(folderId, teamId)}
          creatingNote={creatingNote}
          // BUG 4 FIX: Pass selectedTeamId + setter so the team context is
          // preserved across navigation to FolderDetail and back. Without
          // this, TeamsPage remounts with `selectedTeamId = null` after
          // returning from a folder, landing the user on the Teams grid
          // instead of the team they were just viewing.
          selectedTeamId={selectedTeamId}
          setSelectedTeamId={setSelectedTeamId}
        />
      )}
      {/* FIX: Add key prop to force remount when navigating to different folders */}
      {screen === "folderDetail" && folderDetailState && (
        <FolderDetailPage
          key={`${folderDetailState.folderId}-${folderDetailState.ts || 0}`}
          dark={dark} user={user}
          folderId={folderDetailState.folderId}
          teamId={folderDetailState.teamId}
          folders={folders}
          allNotes={notes}
          onBack={() => setScreen(folderDetailPreviousRef.current)}
          onOpenNote={id => { editorPreviousRef.current = "folderDetail"; setActiveNoteId(id); setScreen("editor"); }}
          onCreateNote={(data) => createNote(data)}
          onGoNotes={() => setScreen("dashboard")}
          onGoTodos={() => setScreen("todos")}
          onGoTeams={() => setScreen("teams")}
          onGoProfile={() => setScreen("profile")}
          onLogout={logout}
          toggleDark={() => setDark(d => !d)}
          onAddFolder={addFolder}
          onFolderDelete={deleteFolder}
          onRefresh={loadData}
          onFolderOpen={(folderId, teamId) => handleFolderOpen(folderId, teamId)}
        />
      )}
      {screen === "todos" && (
        <TodosPage
          dark={dark} user={user}
          notes={notes} folders={folders.filter(f => !f.teamId)}
          onBack={() => setScreen("dashboard")}
          toggleDark={() => setDark(d => !d)}
          onLogout={logout}
          onAddFolder={addFolder}
          onFolderDelete={deleteFolder}
          onGoNotes={() => setScreen("dashboard")}
          onGoTeams={() => setScreen("teams")}
          onGoProfile={() => setScreen("profile")}
          onRefresh={loadData}
          onFolderOpen={(folderId) => handleFolderOpen(folderId, null)}
        />
      )}
      {/* COMBINED FIX #2: Dedicated Profile page for name + password changes. */}
      {screen === "profile" && (
        <ProfilePage
          dark={dark} user={user}
          notes={notes} folders={folders.filter(f => !f.teamId)}
          onBack={() => setScreen("dashboard")}
          toggleDark={() => setDark(d => !d)}
          onLogout={logout}
          onAddFolder={addFolder}
          onFolderDelete={deleteFolder}
          onGoNotes={() => setScreen("dashboard")}
          onGoTeams={() => setScreen("teams")}
          onGoTodos={() => setScreen("todos")}
          onRefresh={loadData}
          onFolderOpen={(folderId) => handleFolderOpen(folderId, null)}
        />
      )}
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: {
            fontFamily: "'Poppins', sans-serif",
            fontSize: "14px",
            fontWeight: 500,
          },
          success: {
            style: { background: "#16a34a", color: "#fff" },
            iconTheme: { primary: "#fff", secondary: "#16a34a" },
          },
          error: {
            style: { background: "#dc2626", color: "#fff" },
            iconTheme: { primary: "#fff", secondary: "#dc2626" },
          },
        }}
      />

      {/* Session Timeout Warning Modal */}
      {showTimeoutWarning && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999,
        }}>
          <div style={{
            background: dark ? "#1e1e2e" : "#fff", borderRadius: 12, padding: 32,
            maxWidth: 400, width: "90%", textAlign: "center",
            boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>⏰</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: dark ? "#e2e8f0" : "#1a202c" }}>
              Session Timeout Warning
            </h2>
            <p style={{ color: dark ? "#a0aec0" : "#718096", marginBottom: 24, fontSize: 14 }}>
              You have been inactive for a while. You will be automatically logged out in 2 minutes.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                onClick={dismissTimeoutWarning}
                style={{
                  padding: "10px 24px", background: "#2383E2", color: "#fff",
                  border: "none", borderRadius: 8, fontWeight: 600, fontSize: 14,
                  cursor: "pointer", fontFamily: "'Poppins', sans-serif",
                }}
              >
                Stay Logged In
              </button>
              <button
                onClick={logout}
                style={{
                  padding: "10px 24px", background: "transparent", color: "#e53e3e",
                  border: "1.5px solid #e53e3e", borderRadius: 8, fontWeight: 600, fontSize: 14,
                  cursor: "pointer", fontFamily: "'Poppins', sans-serif",
                }}
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </QueryClientProvider>
  );
}
