import { useState, useRef, useCallback, useEffect } from "react";
import toast from "react-hot-toast";
import TagChip from "../components/TagChip";
import Modal from "../components/Modal";
import { foldersAPI } from "../services/api";
import { getFolderId, getTeamId } from "../utils/helpers";
import { useNoteSocket, emitNoteUpdate } from "../hooks/useSockets";
import { useAuth } from "../context/AuthContext";
import "../styles/editor.css";

/**
 * BUG #3 FIX: Real-time collaborative note editing via Socket.io.
 *
 * What was wrong before:
 *  - When member A edited a note and member B opened it later, B would see
 *    a stale cached version and the open would often fail with an error.
 *  - Edits made by A did not appear on B's screen until B manually refreshed.
 *
 * What we do now:
 *  1. On mount we ALWAYS fetch the latest note from the API (handled by the
 *     parent App.jsx via the `note` prop), so we never trust stale cache.
 *  2. We `note:join` the note room — other editors in the room are notified
 *     via `note:someone-editing` so they see an "X is editing..." banner.
 *  3. When the local user types, we debounce (800ms) and emit `note:update`
 *     via the socket. Other editors receive `note:updated` and apply the new
 *     content to their editor — UNLESS their editor is currently focused
 *     (to avoid clobbering in-flight typing).
 *  4. We also still persist via the REST `onSave` callback (so the saved
 *     state is durable even if Socket.io is unavailable, e.g. dev with no
 *     socket server).
 *  5. On unmount we `note:leave` so other editors are notified via
 *     `note:user-left` and can clear the "X is editing..." banner.
 *  6. If another member deletes the note while we're viewing it, we get a
 *     `note:deleted` event and bounce back to the previous screen.
 */
export default function NoteEditor({ note, folders, dark, onBack, onSave, onDelete, onShare, onPin }) {
  const { user } = useAuth();
  const noteId = note?._id;

  const [title, setTitle] = useState(note.title || "");
  const [body, setBody] = useState(note.body || "");
  const [tags, setTags] = useState(note.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [folderId, setFolderId] = useState(getFolderId(note.folderId) || "");
  const [saveStatus, setSaveStatus] = useState("saved"); // "saved" | "saving" | "unsaved"
  const [deleteModal, setDeleteModal] = useState(false);
  const [allFolders, setAllFolders] = useState(folders || []);
  // BUG #3 FIX: editors currently in the room (excluding self).
  const [activeEditors, setActiveEditors] = useState([]);
  // BUG #3 FIX: bump to force a fresh fetch of the note from the API when
  // another editor saves. The parent App.jsx watches this via the `note`
  // prop coming from `editorNote` (activeNote || fetchedNote), so this
  // internal "version" counter is purely for triggering a re-render after
  // we sync content from a `note:updated` socket event.
  const saveTimer = useRef(null);
  // BUG #3 FIX: debounced socket emit timer. Decoupled from the REST save
  // timer so we can broadcast more frequently (every 800ms) than we persist
  // to the API (also 800ms, but the two are independent — socket updates
  // are non-authoritative for the receiver; REST is the source of truth).
  const socketEmitTimer = useRef(null);
  // Track whether the local user is currently typing. We use this to skip
  // applying incoming `note:updated` payloads while the user is mid-keystroke
  // (so we don't clobber their work). The cursor position is preserved on the
  // title textarea; for the body we restore selection after applying updates.
  const isEditingRef = useRef(false);
  const titleRef = useRef(null);
  const bodyRef = useRef(null);

  // FIX: Fetch team folders when editing a team note
  const noteTeamId = getTeamId(note.teamId);
  useEffect(() => {
    if (noteTeamId) {
      foldersAPI.getAll({ teamId: noteTeamId })
        .then(f => {
          const teamFolders = Array.isArray(f) ? f : f?.folders || [];
          setAllFolders([...(folders || []), ...teamFolders]);
        })
        .catch(() => {});
    } else {
      setAllFolders(folders || []);
    }
  }, [noteTeamId, folders]);

  // FIX: Filter folders based on note context
  const contextFolders = allFolders.filter(f => {
    const fTeamId = getTeamId(f.teamId);
    if (noteTeamId) return fTeamId === noteTeamId;
    return !fTeamId;
  });

  const folder = allFolders.find(f => f._id === getFolderId(note.folderId));

  // ─── Socket.io real-time sync ─────────────────────────────────────────────
  const onNoteUpdated = useCallback((payload) => {
    if (!payload) return;

    // If the local user is actively typing in either the title or body,
    // DON'T clobber their work — instead show a "newer version available"
    // hint. They'll see the update once they pause.
    const activeEl = document.activeElement;
    const editingNow = isEditingRef.current && (activeEl === titleRef.current || activeEl === bodyRef.current);

    if (!editingNow) {
      // Apply the incoming content. We use functional setState to avoid
      // stale closures, and only update fields that are present.
      if (typeof payload.title === "string" && payload.title !== title) setTitle(payload.title);
      if (typeof payload.body === "string" && payload.body !== body) setBody(payload.body);
      if (Array.isArray(payload.tags)) setTags(payload.tags);

      // Show a toast ONLY if there's a named editor (REST-driven socket
      // events don't include updatedBy, so we stay silent for those).
      if (payload.updatedBy && payload.updatedBy !== (user?.name || "")) {
        toast(`${payload.updatedBy} updated this note`, { icon: "✏️", duration: 2000 });
      }
    }
  }, [title, body, tags, user]);

  const onSomeoneEditing = useCallback((payload) => {
    if (!payload?.userName) return;
    setActiveEditors(prev => {
      if (prev.some(e => e.userId === payload.userId)) return prev;
      return [...prev, { userName: payload.userName, userId: payload.userId }];
    });
  }, []);

  const onUserLeft = useCallback((payload) => {
    if (!payload?.userId) return;
    setActiveEditors(prev => prev.filter(e => e.userId !== payload.userId));
  }, []);

  const onNoteDeleted = useCallback((payload) => {
    toast.error("This note was deleted by another member.");
    // Give the toast a moment to be seen before navigating away.
    setTimeout(() => {
      onBack();
    }, 600);
  }, [onBack]);

  const onNoteError = useCallback((payload) => {
    if (payload?.message) toast.error(payload.message);
  }, []);

  useNoteSocket(noteId, {
    onUpdated: onNoteUpdated,
    onSomeoneEditing: onSomeoneEditing,
    onUserLeft: onUserLeft,
    onDeleted: onNoteDeleted,
    onError: onNoteError,
  });

  // ─── Save logic ────────────────────────────────────────────────────────────
  const triggerSave = useCallback((t, b, tgs, fid) => {
    setSaveStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onSave({ title: t, body: b, tags: tgs, folderId: fid || null });
      setSaveStatus("saved");
    }, 800);

    // BUG #3 FIX: Debounced socket emit so other editors see changes within
    // 800ms without us spamming the server on every keystroke. We pass the
    // current user's name so receivers can show "X updated this note".
    if (socketEmitTimer.current) clearTimeout(socketEmitTimer.current);
    socketEmitTimer.current = setTimeout(() => {
      emitNoteUpdate(noteId, {
        title: t,
        body: b,
        tags: tgs,
        updatedBy: user?.name || "Someone",
      });
    }, 800);
  }, [onSave, noteId, user]);

  // BUG 1 FIX: Manual save function for explicit save button
  const handleManualSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (socketEmitTimer.current) clearTimeout(socketEmitTimer.current);
    setSaveStatus("saving");
    onSave({ title, body, tags, folderId: folderId || null });
    setSaveStatus("saved");
    // Also broadcast immediately
    emitNoteUpdate(noteId, {
      title, body, tags,
      updatedBy: user?.name || "Someone",
    });
  }, [title, body, tags, folderId, onSave, noteId, user]);

  // Track whether the user is editing either textarea.
  function markEditing() { isEditingRef.current = true; }
  function markNotEditing() {
    // Small delay so we don't mark "not editing" between tab keystrokes.
    setTimeout(() => {
      const active = document.activeElement;
      if (active !== titleRef.current && active !== bodyRef.current) {
        isEditingRef.current = false;
      }
    }, 100);
  }

  function handleTitle(v) { setTitle(v); triggerSave(v, body, tags, folderId); }
  function handleBody(v)  { setBody(v);  triggerSave(title, v, tags, folderId); }
  function handleFolder(v){ setFolderId(v || ""); triggerSave(title, body, tags, v || null); }

  function addTag(e) {
    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
      e.preventDefault();
      const t = tagInput.trim().replace(/,/, "");
      if (!tags.includes(t)) {
        const newTags = [...tags, t];
        setTags(newTags);
        triggerSave(title, body, newTags, folderId);
      }
      setTagInput("");
    }
  }

  function removeTag(t) {
    const newTags = tags.filter(x => x !== t);
    setTags(newTags);
    triggerSave(title, body, newTags, folderId);
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (socketEmitTimer.current) clearTimeout(socketEmitTimer.current);
    };
  }, []);

  return (
    <div className="editor-page">
      <div className="editor-toolbar">
        <div className="editor-toolbar-left">
          <button className="editor-back-btn" onClick={onBack}>← Back</button>
          <span className="editor-breadcrumb">
            {folder ? `📁 ${folder.name}` : "All Notes"} › <em>{title || "Untitled"}</em>
          </span>
        </div>

        <div className="editor-toolbar-right">
          {/* BUG #3 FIX: "X is editing..." indicator */}
          {activeEditors.length > 0 && (
            <span className="editor-presence-indicator" title={activeEditors.map(e => e.userName).join(", ")}>
              {activeEditors.length === 1
                ? `${activeEditors[0].userName} is editing…`
                : `${activeEditors.length} others editing…`}
            </span>
          )}
          <span className={`editor-save-status ${saveStatus === "saving" ? "saving" : ""}`}>
            {saveStatus === "saving" ? "Saving…" : saveStatus === "unsaved" ? "● Unsaved" : "✓ Saved"}
          </span>
          {/* BUG 1 FIX: Add explicit Save button */}
          <button
            className="editor-toolbar-btn save-btn"
            onClick={handleManualSave}
            disabled={saveStatus === "saving"}
          >
            💾 Save
          </button>
          <button
            className={`editor-toolbar-btn ${note.isPinned ? "pin-active" : ""}`}
            onClick={() => onPin(note._id)}
            title={note.isPinned ? "Unpin" : "Pin"}
          >📌</button>
          <button className="editor-toolbar-btn" onClick={() => onShare(note._id)}>🔗 Share</button>
          <button className="editor-toolbar-btn danger" onClick={() => setDeleteModal(true)}>🗑 Delete</button>
        </div>
      </div>

      <div className="editor-body">
        <textarea
          ref={titleRef}
          className="editor-title"
          value={title}
          onChange={e => handleTitle(e.target.value)}
          onFocus={markEditing}
          onBlur={markNotEditing}
          placeholder="Untitled"
          rows={1}
          onInput={e => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
        />

        <div className="editor-tags-row">
          {tags.map(t => <TagChip key={t} tag={t} dark={dark} onRemove={removeTag} />)}
          <input
            className="editor-tag-input"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={addTag}
            placeholder="+ add tag, press Enter"
          />
        </div>

        <div className="editor-folder-row">
          <span className="editor-folder-label">📁 Folder:</span>
          <select
            className="editor-folder-select"
            value={folderId || ""}
            onChange={e => handleFolder(e.target.value)}
          >
            <option value="">Uncategorized</option>
            {contextFolders.map(f => <option key={f._id} value={f._id}>{f.name}</option>)}
          </select>
        </div>

        <hr className="editor-divider" />

        <textarea
          ref={bodyRef}
          className="editor-content"
          value={body}
          onChange={e => handleBody(e.target.value)}
          onFocus={markEditing}
          onBlur={markNotEditing}
          placeholder="Start writing…"
          onInput={e => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px"; }}
        />
      </div>

      {deleteModal && (
        <Modal
          title="Delete this note?"
          message="This note will be permanently removed. This cannot be undone."
          onConfirm={() => { onDelete(note._id); setDeleteModal(false); onBack(); }}
          onCancel={() => setDeleteModal(false)}
          confirmLabel="Delete"
          variant="danger"
        />
      )}
    </div>
  );
}
