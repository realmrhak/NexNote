import "../styles/skeletons.css";

export function NoteSkeleton() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-line w60" />
      <div className="skeleton-line w90" />
      <div className="skeleton-line w40" />
      <div className="skeleton-line w30 sm" />
    </div>
  );
}

export function NoteGridSkeleton({ count = 6 }) {
  return (
    <div className="notes-grid">
      {Array.from({ length: count }, (_, i) => <NoteSkeleton key={i} />)}
    </div>
  );
}

export function TeamCardSkeleton() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-line w10 circle" />
      <div className="skeleton-line w50" />
      <div className="skeleton-line w80 sm" />
      <div className="skeleton-line w30 sm" />
    </div>
  );
}

export function TeamGridSkeleton({ count = 3 }) {
  return (
    <div className="teams-grid">
      {Array.from({ length: count }, (_, i) => <TeamCardSkeleton key={i} />)}
    </div>
  );
}

export function TodoSkeleton({ count = 5 }) {
  return (
    <div className="todo-list">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-card row">
          <div className="skeleton-line w5 circle" />
          <div className="skeleton-line w70" />
        </div>
      ))}
    </div>
  );
}

export function FolderSkeleton() {
  return (
    <div className="skeleton-card row">
      <div className="skeleton-line w8 circle" />
      <div className="skeleton-line w40" />
    </div>
  );
}

export function FullPageSkeleton() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontSize: 28, fontWeight: 800, color: "var(--text-primary)" }}>
          Nex<span style={{ color: "#2383E2" }}>Note</span>
        </h2>
        <div style={{ marginTop: 16 }}>
          <div className="skeleton-pulse" style={{ width: 120, height: 4, borderRadius: 2, margin: "0 auto" }} />
        </div>
      </div>
    </div>
  );
}
