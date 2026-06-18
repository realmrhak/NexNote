import TagChip from "../components/TagChip";
import "../styles/shared.css";

export default function SharedNotePage({ note, dark, onBack }) {
  return (
    <div className="shared-page">
      <div className="shared-header">
        <button className="shared-logo-btn" onClick={onBack}>
          Nex<span>Note</span>
        </button>
        <span className="shared-badge">Shared Note · Read Only</span>
      </div>

      <div className="shared-body">
        <h1 className="shared-title">{note.title || "Untitled"}</h1>

        <div className="shared-tags">
          {note.tags.map(t => <TagChip key={t} tag={t} dark={dark} />)}
        </div>

        <hr className="shared-divider" />

        <pre className="shared-content">{note.body}</pre>

        <div className="shared-footer">
          Created with <span>NexNote</span>
        </div>
      </div>
    </div>
  );
}
