import { getTagColor } from "../utils/helpers";
import "../styles/notecard.css";

export default function TagChip({ tag, dark, onRemove }) {
  const style = getTagColor(tag, dark);
  return (
    <span className="tag-chip" style={style}>
      {tag}
      {onRemove && (
        <button className="tag-remove-btn" onClick={() => onRemove(tag)}>×</button>
      )}
    </span>
  );
}
