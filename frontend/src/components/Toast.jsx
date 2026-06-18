import "../styles/shared.css";

export default function Toast({ toasts }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.type === "error" ? "toast-error" : "toast-success"}`}>
          <span className="toast-icon">{t.type === "error" ? "❌" : "✅"}</span>
          <span className="toast-message">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
