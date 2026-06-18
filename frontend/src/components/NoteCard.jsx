import { useState, memo } from "react";
import TagChip from "./TagChip";
import { relativeTime, getFolderId } from "../utils/helpers";
import "../styles/notecard.css";

function NoteCard({ note, dark, folders, onClick, onPin, onDelete, onShare }) {
  const [menuOpen, setMenuOpen] = useState(false);
  // FIX: Use getFolderId to handle populated folderId (object) vs raw string ID
  const folder = folders.find(f => f._id === getFolderId(note.folderId));

  return (
    <div className="note-card anim-fade-up" onClick={onClick}>
      <div className="note-card-header">
        <p className="note-card-title">{note.title || "Untitled"}</p>
        <div className="note-card-actions">
          <button
            className={`note-pin-btn ${note.isPinned ? "pinned" : ""}`}
            title={note.isPinned ? "Unpin" : "Pin"}
            onClick={e => { e.stopPropagation(); onPin(note._id); }}
          >📌</button>
          <div className="note-menu-wrap">
            <button
              className="note-menu-btn"
              onClick={e => { e.stopPropagation(); setMenuOpen(m => !m); }}
            >⋯</button>
            {menuOpen && (
              <div className="note-dropdown" onClick={e => e.stopPropagation()}>
                <button className="note-dropdown-item" onClick={() => { onClick(); setMenuOpen(false); }}>✏️ Edit</button>
                <button className="note-dropdown-item" onClick={() => { onShare(note._id); setMenuOpen(false); }}>🔗 Share</button>
                <button className="note-dropdown-item danger" onClick={() => { onDelete(note._id); setMenuOpen(false); }}>🗑 Delete</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {folder && <p className="note-folder-badge">📁 {folder.name}</p>}

      <p className="note-body-preview">{note.body || <em>No content yet.</em>}</p>

      <div className="note-card-footer">
        <div className="note-tags">
          {note.tags.map(t => <TagChip key={t} tag={t} dark={dark} />)}
        </div>
        <span className="note-time">{relativeTime(note.updatedAt)}</span>
      </div>
    </div>
  );
}

export default memo(NoteCard);
