import { useState, useEffect} from "react";
import Sidebar from "../components/Sidebar";
import NoteCard from "../components/NoteCard";
import Modal from "../components/Modal";
import { useDebounce } from "../hooks/useDebounce";
import { NoteGridSkeleton } from "../components/Skeletons";
import { useQueryClient } from "@tanstack/react-query";
import { teamsAPI, todosAPI } from "../services/api";
import { noteInFolder, getFolderId } from "../utils/helpers";
import "../styles/dashboard.css";

export default function Dashboard({
  notes, folders, user, dark, toggleDark,
  onOpenNote, onCreateNote, onDeleteNote, onPinNote, onShareNote, onAddFolder, onFolderDelete, onLogout,
  onGoTeams, onGoTodos, onGoProfile, onRefresh,
  onFolderOpen,
  creatingNote = false,
}) {
  const [searchInput, setSearchInput] = useState("");
  const [activeFolder, setActiveFolder] = useState(null);
  const [activeTag, setActiveTag] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const queryClient = useQueryClient();

  // Prefetch teams data on hover for instant page load
  const prefetchTeams = () => {
    queryClient.prefetchQuery({
      queryKey: ["teams"],
      queryFn: () => teamsAPI.getMyTeams().then(data => Array.isArray(data) ? data : []),
    });
  };

  // Prefetch todos data on hover for instant page load
  const prefetchTodos = () => {
    queryClient.prefetchQuery({
      queryKey: ["todos", {}],
      queryFn: () => todosAPI.getAll({}),
    });
  };

  // Debounce search input
  const search = useDebounce(searchInput, 300);

  // Responsive listener for window resize
  useEffect(() => {
    function handleResize() { setIsMobile(window.innerWidth < 768); }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // FIX: Use noteInFolder helper to handle populated folderId (object) vs string ID
  let filtered = notes;
  if (activeFolder === "pinned") filtered = filtered.filter(n => n.isPinned);
  else if (activeFolder) filtered = filtered.filter(n => noteInFolder(n, activeFolder));
  if (activeTag) filtered = filtered.filter(n => n.tags && n.tags.includes(activeTag));
  if (search) filtered = filtered.filter(n =>
    (n.title || "").toLowerCase().includes(search.toLowerCase()) ||
    (n.body || "").toLowerCase().includes(search.toLowerCase())
  );

  const pinned = filtered.filter(n => n.isPinned && activeFolder !== "pinned");
  const regular = filtered.filter(n => !n.isPinned || activeFolder === "pinned");

  // FIX: When creating note from Dashboard with a folder selected, pass the folderId
  function handleCreateNote() {
    if (activeFolder && activeFolder !== "pinned") {
      onCreateNote({ folderId: activeFolder });
    } else {
      onCreateNote();
    }
  }

  return (
    <div className="dashboard">
      {isMobile && sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <div className={`sidebar-wrapper ${isMobile ? "mobile" : ""} ${sidebarOpen ? "open" : ""}`}>
        <Sidebar
          dark={dark} user={user} folders={folders} notes={notes}
          activeFolder={activeFolder} activeTag={activeTag} activeSection="notes"
          onFolderSelect={id => { setActiveFolder(id); setActiveTag(null); setSidebarOpen(false); }}
          onFolderOpen={folderId => {
            if (onFolderOpen) onFolderOpen(folderId);
            setSidebarOpen(false);
          }}
          onTagSelect={t => { setActiveTag(activeTag === t ? null : t); setActiveFolder(null); setSidebarOpen(false); }}
          onAllNotes={() => { setActiveFolder(null); setActiveTag(null); setSidebarOpen(false); }}
          onPinned={() => { setActiveFolder("pinned"); setActiveTag(null); setSidebarOpen(false); }}
          onAddFolder={onAddFolder}
          onFolderDelete={onFolderDelete}
          onLogout={onLogout}
          toggleDark={toggleDark}
          onGoTeams={() => { onGoTeams(); setSidebarOpen(false); }}
          onGoTodos={() => { onGoTodos(); setSidebarOpen(false); }}
          onGoProfile={() => { if (onGoProfile) onGoProfile(); setSidebarOpen(false); }}
          onHoverTeams={prefetchTeams}
          onHoverTodos={prefetchTodos}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <div className="dashboard-main">
        <div className="dashboard-header">
          <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>☰</button>
          <div className="search-bar">
            <span className="search-bar-icon">🔍</span>
            <input
              value={searchInput} onChange={e => setSearchInput(e.target.value)}
              placeholder="Search notes…"
            />
            {searchInput && <button className="search-clear-btn" onClick={() => { setSearchInput(""); }}>×</button>}
          </div>
        </div>

        <div className="notes-area">
          {pinned.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <p className="notes-section-label">📌 Pinned</p>
              <div className="notes-grid stagger">
                {pinned.map(n => (
                  <NoteCard key={n._id} note={n} dark={dark} folders={folders}
                    onClick={() => onOpenNote(n._id)}
                    onPin={onPinNote}
                    onDelete={id => setDeleteTarget(id)}
                    onShare={onShareNote}
                  />
                ))}
              </div>
            </div>
          )}

          {regular.length > 0 && (
            <div>
              {pinned.length > 0 && <p className="notes-section-label">Notes</p>}
              <div className="notes-grid stagger">
                {regular.map(n => (
                  <NoteCard key={n._id} note={n} dark={dark} folders={folders}
                    onClick={() => onOpenNote(n._id)}
                    onPin={onPinNote}
                    onDelete={id => setDeleteTarget(id)}
                    onShare={onShareNote}
                  />
                ))}
              </div>
            </div>
          )}

          {filtered.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-icon">📄</div>
              <h2>{search ? "No matching notes" : "No notes yet"}</h2>
              <p>{search ? "Try a different search term." : "Create your first note and it will appear here."}</p>
              {!search && (
                <button
                  className="empty-state-btn"
                  onClick={handleCreateNote}
                  disabled={creatingNote}
                  style={creatingNote ? { opacity: 0.7, cursor: "wait" } : {}}
                >
                  {creatingNote ? "Creating..." : "+ Create Note"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <button
        className="fab"
        onClick={handleCreateNote}
        disabled={creatingNote}
        title={creatingNote ? "Creating note..." : "New note"}
        style={creatingNote ? { opacity: 0.7, cursor: "wait" } : {}}
      >
        {creatingNote ? "..." : "+"}
      </button>

      {deleteTarget && (
        <Modal
          title="Delete note?"
          message="This note will be permanently removed. This cannot be undone."
          onConfirm={() => { onDeleteNote(deleteTarget); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
          confirmLabel="Delete"
          variant="danger"
        />
      )}

      {/* COMBINED FIX #4a: Bottom navigation bar removed.
          Mobile users navigate via the hamburger-menu sidebar (which
          already contains Notes / Teams / Todos / Profile / Log out). */}
    </div>
  );
}
