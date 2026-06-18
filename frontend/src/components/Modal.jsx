import "../styles/shared.css";

export default function Modal({ title, message, onConfirm, onCancel, confirmLabel, variant, children, confirmDisabled }) {
  const label = confirmLabel || "Confirm";
  const isDanger = variant === "danger" || label === "Delete";
  const isPending = label.endsWith("..."); // Detect loading state from label like "Sending...", "Creating..."

  return (
    <div className="modal-overlay" onClick={!isPending ? onCancel : undefined}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <p className="modal-title">{title}</p>
        {message && <p className="modal-message">{message}</p>}
        {children}
        <div className="modal-actions">
          <button className="modal-cancel-btn" onClick={onCancel} disabled={isPending}>Cancel</button>
          <button
            className={`modal-confirm-btn ${isDanger ? "danger" : "primary"}`}
            onClick={onConfirm}
            disabled={isPending || confirmDisabled}
          >
            {label}
          </button>
        </div>
      </div>
    </div>
  );
}
