import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import Sidebar from "../components/Sidebar";
import NoteCard from "../components/NoteCard";
import { notesAPI, foldersAPI } from "../services/api";
import { NoteGridSkeleton } from "../components/Skeletons";
import { getFolderId, getTeamId } from "../utils/helpers";
import "../styles/teams.css";

export default function FolderDetailPage({
  dark, user, folderId, teamId, folders, allNotes = [], onBack, onOpenNote, onCreateNote,
  onGoNotes, onGoTodos, onGoTeams, onGoProfile, onLogout, toggleDark, onAddFolder, onFolderDelete, onRefresh,
  onFolderOpen,
}) {
  const [folder, setFolder] = useState(null);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [localFolders, setLocalFolders] = useState(folders || []);

  // Load folders for sidebar — always fetch the correct context
  useEffect(() => {
    // FIX: When in team context, always fetch team folders from API
    // because the parent App.jsx only passes personal folders
    if (teamId) {
      foldersAPI.getAll({ teamId })
        .then(f => setLocalFolders(Array.isArray(f) ? f : f?.folders || []))
        .catch(() => {});
    } else if (!folders || folders.length === 0) {
      foldersAPI.getAll()
        .then(f => setLocalFolders(Array.isArray(f) ? f : f?.folders || []))
        .catch(() => {});
    } else {
      // For personal context, filter to only personal folders
      setLocalFolders(folders.filter(f => !getTeamId(f.teamId)));
    }
  }, [folders, teamId]);

  // Responsive listener
  useEffect(() => {
    function handleResize() { setIsMobile(window.innerWidth < 768); }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // FIX: Load folder and its notes — ensure folderId is properly passed to API
  useEffect(() => {
    if (!folderId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        // FIX: Build query params properly for the notes API
        const notesParams = { folderId };
        // Only add teamId if it's a team folder context
        if (teamId) {
          notesParams.teamId = teamId;
        }

        const [folderData, notesData] = await Promise.all([
          foldersAPI.getById(folderId),
          notesAPI.getAll(notesParams),
        ]);

        if (cancelled) return;

        setFolder(folderData);
        // FIX: Handle both array and object response formats from API
        const notesList = Array.isArray(notesData) ? notesData : notesData?.notes || [];
        setNotes(notesList);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load folder:", err);
          toast.error("Failed to load folder");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();

    return () => { cancelled = true; };
  }, [folderId, teamId]);

  async function handleCreateNote() {
    onCreateNote({ folderId, ...(teamId ? { teamId } : {}), title: "", body: "", tags: [] });
  }

  if (loading) return <div className="teams-page"><NoteGridSkeleton count={3} /></div>;

  return (
    <div className="teams-page">
      {isMobile && sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <div className={`sidebar-wrapper ${isMobile ? "mobile" : ""} ${sidebarOpen ? "open" : ""}`}>
        <Sidebar
          // BUG 2 FIX: Filter allNotes to PERSONAL notes only before passing
          // to Sidebar. App.jsx's `notes` state is supposed to contain only
          // personal notes, but defense-in-depth here guarantees the
          // "All Notes" / "Pinned" counts in the Sidebar are always the
          // user's global personal totals, regardless of which folder or
          // team the user is currently viewing.
          dark={dark} user={user} folders={localFolders} notes={(allNotes || []).filter(n => !getTeamId(n.teamId))}
          onAllNotes={onGoNotes} onPinned={onGoNotes}
          onLogout={onLogout} toggleDark={toggleDark}
          onGoTeams={onGoTeams} onGoTodos={onGoTodos}
          onGoProfile={onGoProfile}
          onAddFolder={onAddFolder} onFolderDelete={onFolderDelete}
          onFolderOpen={(fId) => { if (onFolderOpen) onFolderOpen(fId, teamId); setSidebarOpen(false); }}
          activeFolder={folderId}
          activeSection={teamId ? "teams" : "folderDetail"}
          teamId={teamId}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <div className="teams-main">
        {isMobile && (
          <div className="teams-mobile-header">
            <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>☰</button>
            <h1>{folder?.name || "Folder"}</h1>
            <button className="teams-btn-primary mobile-add-btn" onClick={handleCreateNote}>+</button>
          </div>
        )}

        <button className="team-back-btn" onClick={onBack}>← Back</button>

        <div className="team-detail-header">
          <div>
            <h2>📁 {folder?.name || "Folder"}</h2>
            {teamId && <p className="team-desc">Team folder</p>}
          </div>
          {!isMobile && (
            <button className="teams-btn-primary" onClick={handleCreateNote}>+ New Note</button>
          )}
        </div>

        {notes.length === 0 ? (
          <div className="teams-empty">
            <div className="teams-empty-icon">📂</div>
            <h2>This folder is empty</h2>
            <p>Create your first note in this folder.</p>
            <button className="teams-btn-primary" onClick={handleCreateNote}>+ Create Note</button>
          </div>
        ) : (
          <div className="team-notes-grid">
            {notes.map(note => (
              <div key={note._id} className="team-note-card" onClick={() => onOpenNote(note._id)}>
                <div className="team-note-title">{note.title || "Untitled"}</div>
                <div className="team-note-preview">{note.body || "No content yet"}</div>
                <div className="team-note-meta">
                  <span className="team-note-time">{new Date(note.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* COMBINED FIX #4a: Bottom navigation bar removed. */}
    </div>
  );
}
