import { useState, useRef, useEffect } from "react";
import { noteInFolder, getTeamId } from "../utils/helpers";
import "../styles/sidebar.css";

export default function Sidebar({
  dark, user, folders, notes, activeFolder, activeTag, activeSection,
  onFolderSelect, onFolderOpen, onTagSelect, onAllNotes, onPinned,
  onAddFolder, onFolderDelete, onLogout, toggleDark, onGoTeams, onGoTodos, onGoProfile,
  onClose, // mobile close callback
  onHoverTeams, onHoverTodos, // prefetch callbacks on hover
  teamId, // filter folders by team context
}) {
  const [newFolderName, setNewFolderName] = useState("");
  const [addingFolder, setAddingFolder]   = useState(false);
  const [folderMenuId, setFolderMenuId]   = useState(null);
  const menuRef = useRef(null);

  // BUG 2 FIX: All Notes and Pinned counts must ALWAYS reflect the user's
  // global personal note totals (excluding team notes), regardless of which
  // folder or team the user is currently viewing. The previous implementation
  // derived these counts from `contextNotes`, which was filtered by the
  // current team/folder context — so navigating into a folder would shrink
  // the counts to just that folder's notes.
  const personalNotes = (notes || []).filter(n => !getTeamId(n.teamId));
  const allNotesCount = personalNotes.length;
  const pinnedCount   = personalNotes.filter(n => n.isPinned).length;

  // FIX: Filter folders by team context
  // - When teamId is provided, show only folders belonging to that team
  // - When no teamId (personal context), show only personal folders (teamId: null)
  const filteredFolders = (folders || []).filter(f => {
    const fTeamId = getTeamId(f.teamId);
    if (teamId) return fTeamId === String(teamId);
    return !fTeamId; // personal folders only
  });

  // Tags list — derived from personal notes only, so it stays stable across
  // folder/team navigation.
  const allTags = [...new Set(personalNotes.flatMap(n => n.tags || []))];

  // Helper: count notes for a given folder.
  // - Personal context: count from personalNotes (already in memory).
  // - Team context: each team folder already carries a `noteCount` field
  //   populated by the backend (see folderService.getFolders). Use that to
  //   avoid needing all team notes in memory just to compute counts.
  function folderNoteCount(f) {
    if (teamId) return f.noteCount || 0;
    return personalNotes.filter(n => noteInFolder(n, f._id)).length;
  }

  // Close folder menu when clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setFolderMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function NavItem({ label, active, onClick, count, onMouseEnter, icon }) {
    return (
      <button
        className={`sidebar-nav-item ${active ? "active" : ""}`}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        title={label.replace(/[^\w\s]/gi, '').trim()}
      >
        {icon && <span className="sidebar-nav-icon">{icon}</span>}
        <span className="sidebar-nav-label">{label}</span>
        {count !== undefined && (
          <span className="sidebar-nav-count">{count}</span>
        )}
      </button>
    );
  }

  return (
    <div className="sidebar">
      {/* Mobile close button */}
      {onClose && (
        <button className="sidebar-close-btn" onClick={onClose}>✕</button>
      )}

      <div className="sidebar-header">
        <div className="sidebar-logo">Nex<span>Note</span></div>
        {/* FIX #5 v2: User row is now CLICKABLE to open the Profile page.
            The separate "Profile" nav item below has been removed to avoid
            redundancy — clicking the user's avatar/name is more intuitive
            and matches the spec ("Sidebar mein alag se Profile link nahi
            chahiye — jahan user ka naam dikhta hai wahan click karne par
            profile page open ho"). */}
        <button
          type="button"
          className="sidebar-user sidebar-user-clickable"
          onClick={() => { if (onGoProfile) onGoProfile(); if (onClose) onClose(); }}
          title="Open profile settings"
        >
          <div className="sidebar-avatar">{(user?.name || "U")[0].toUpperCase()}</div>
          <div className="sidebar-user-info">
            <span className="sidebar-username">{user?.name || "User"}</span>
            <span className="sidebar-useremail">{user?.email || ""}</span>
          </div>
          <span className="sidebar-user-chevron" aria-hidden>⚙</span>
        </button>
      </div>

      <div className="sidebar-section">
        <NavItem
          label="All Notes"
          icon="📝"
          active={!activeFolder && !activeTag && activeSection === "notes"}
          onClick={() => { onAllNotes(); if (onClose) onClose(); }}
          count={allNotesCount}
        />
        <NavItem
          label="Pinned"
          icon="📌"
          active={activeFolder === "pinned"}
          onClick={() => { onPinned(); if (onClose) onClose(); }}
          count={pinnedCount}
        />
      </div>

      <div className="sidebar-section">
        <p className="sidebar-section-label">Workspace</p>
        <NavItem
          label="Teams"
          icon="👥"
          active={activeSection === "teams"}
          onClick={() => { onGoTeams(); if (onClose) onClose(); }}
          onMouseEnter={onHoverTeams}
        />
        <NavItem
          label="Todos"
          icon="✅"
          active={activeSection === "todos"}
          onClick={() => { onGoTodos(); if (onClose) onClose(); }}
          onMouseEnter={onHoverTodos}
        />
        {/* FIX #5 v2: Profile nav item removed — the user row at the top of
            the sidebar is now clickable to open Profile. */}
      </div>

      <div className="sidebar-section">
        <p className="sidebar-section-label">{teamId ? "Team Folders" : "Folders"}</p>
        {filteredFolders.map(f => (
          <div key={f._id} className="sidebar-folder-item">
            <NavItem
              label={f.name}
              icon="📁"
              active={activeFolder === f._id}
              onClick={() => {
                if (onFolderOpen) onFolderOpen(f._id);
                else if (onFolderSelect) onFolderSelect(f._id);
                if (onClose) onClose();
              }}
              count={folderNoteCount(f)}
            />
            <div className="sidebar-folder-menu-wrap" ref={folderMenuId === f._id ? menuRef : null}>
              <button
                className="sidebar-folder-menu-btn"
                onClick={(e) => { e.stopPropagation(); setFolderMenuId(folderMenuId === f._id ? null : f._id); }}
                title="Folder options"
              >⋯</button>
              {folderMenuId === f._id && (
                <div className="sidebar-folder-dropdown" onClick={e => e.stopPropagation()}>
                  <button
                    className="sidebar-folder-dropdown-item danger"
                    onClick={() => { onFolderDelete(f._id); setFolderMenuId(null); }}
                  >🗑 Delete Folder</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {/* Only show Add folder for personal context */}
        {!teamId && (
          addingFolder ? (
            <input
              className="sidebar-folder-input"
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              placeholder="Folder name…"
              onKeyDown={e => {
                if (e.key === "Enter") { onAddFolder(newFolderName); setNewFolderName(""); setAddingFolder(false); }
                if (e.key === "Escape") setAddingFolder(false);
              }}
            />
          ) : (
            <button className="sidebar-add-folder" onClick={() => setAddingFolder(true)}>+ Add folder</button>
          )
        )}
      </div>

      {allTags.length > 0 && (
        <div className="sidebar-section">
          <p className="sidebar-section-label">Tags</p>
          <div className="sidebar-tags">
            {allTags.map(t => (
              <span
                key={t}
                className={`sidebar-tag-chip ${activeTag === t ? "active" : ""}`}
                onClick={() => { onTagSelect(t); if (onClose) onClose(); }}
                style={(() => {
                  const colors = [
                    { bg: "#EEF3FF", text: "#3730A3", darkBg: "#1e1b4b", darkText: "#a5b4fc" },
                    { bg: "#F0FDF4", text: "#166534", darkBg: "#14532d", darkText: "#86efac" },
                    { bg: "#FFF7ED", text: "#9A3412", darkBg: "#431407", darkText: "#fdba74" },
                    { bg: "#FDF4FF", text: "#6B21A8", darkBg: "#3b0764", darkText: "#d8b4fe" },
                    { bg: "#FFF1F2", text: "#9F1239", darkBg: "#4c0519", darkText: "#fda4af" },
                    { bg: "#F0FDFA", text: "#134E4A", darkBg: "#042f2e", darkText: "#5eead4" },
                  ];
                  const i = Math.abs([...t].reduce((a, c) => a + c.charCodeAt(0), 0)) % colors.length;
                  const c = colors[i];
                  return dark ? { background: c.darkBg, color: c.darkText } : { background: c.bg, color: c.text };
                })()}
              >{t}</span>
            ))}
          </div>
        </div>
      )}

      <div className="sidebar-footer">
        <button className="sidebar-icon-btn" onClick={toggleDark} title="Toggle dark mode">
          {dark ? "☀️" : "🌙"}
        </button>
        <button className="sidebar-logout-btn" onClick={onLogout}>Log out</button>
      </div>
    </div>
  );
}
