import { useState, useEffect } from "react";
import Sidebar from "../components/Sidebar";
import Modal from "../components/Modal";
import { foldersAPI } from "../services/api";
import { useTodos, useTodoStats, useCreateTodo, useUpdateTodo, useDeleteTodo, useToggleTodo } from "../hooks/useQueries";
import { TodoSkeleton } from "../components/Skeletons";
import "../styles/todos.css";

export default function TodosPage({
  dark, user, notes, folders, onBack, toggleDark, onLogout, onAddFolder, onFolderDelete,
  onGoNotes, onGoTeams, onGoProfile, onRefresh,
  onFolderOpen,
}) {
  const [filter, setFilter]         = useState("all"); // all | active | completed
  const [showCreate, setShowCreate] = useState(false);
  const [newTodo, setNewTodo]       = useState({ title: "", description: "", priority: "medium", dueDate: "" });
  const [editTodo, setEditTodo]     = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [error, setError]          = useState("");
  const [sidebarOpen, setSidebarOpen]  = useState(false);
  const [isMobile, setIsMobile]        = useState(window.innerWidth < 768);

  const { data: todos = [], isLoading: todosLoading } = useTodos();
  const { data: stats } = useTodoStats();
  const createMutation = useCreateTodo();
  const updateMutation = useUpdateTodo();
  const deleteMutation = useDeleteTodo();
  const toggleMutation = useToggleTodo();

  // BUG #4 FIX: TodosPage only shows PERSONAL todos (no team context here),
  // so we don't subscribe to any team room. Real-time updates for personal
  // todos aren't possible across tabs without a user-room broadcast, which
  // we omit for simplicity. Personal todo toggles are already optimistic in
  // the useToggleTodo mutation, so the local UI updates instantly.

  const showSkeleton = todosLoading && todos.length === 0;

  // FIX: Load personal folders only for sidebar
  const [localFolders, setLocalFolders] = useState([]);

  useEffect(() => {
    foldersAPI.getAll().then(f => {
      const allFolders = Array.isArray(f) ? f : f?.folders || [];
      // Only show personal folders in sidebar
      const personalFolders = allFolders.filter(folder => !folder.teamId);
      setLocalFolders(personalFolders);
    }).catch(() => {});
  }, [folders]);

  useEffect(() => {
    function handleResize() { setIsMobile(window.innerWidth < 768); }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  async function handleCreate() {
    if (!newTodo.title.trim()) { setError("Title is required"); return; }
    try {
      await createMutation.mutateAsync({
        ...newTodo,
        dueDate: newTodo.dueDate || undefined,
      });
      setShowCreate(false);
      setNewTodo({ title: "", description: "", priority: "medium", dueDate: "" });
      setError("");
    } catch (err) { setError(err.response?.data?.message || "Failed to create todo"); }
  }

  async function handleToggle(id) {
    try {
      await toggleMutation.mutateAsync(id);
    } catch (err) { setError(err.response?.data?.message || "Failed to toggle todo"); }
  }

  async function handleDelete(id) {
    try {
      await deleteMutation.mutateAsync(id);
      setDeleteTarget(null);
    } catch (err) { setError(err.response?.data?.message || "Failed to delete todo"); }
  }

  async function handleUpdate() {
    if (!editTodo.title.trim()) { setError("Title is required"); return; }
    try {
      await updateMutation.mutateAsync({
        id: editTodo._id,
        data: {
          title: editTodo.title,
          description: editTodo.description,
          priority: editTodo.priority,
          dueDate: editTodo.dueDate || undefined,
        },
      });
      setEditTodo(null);
      setError("");
    } catch (err) { setError(err.response?.data?.message || "Failed to update todo"); }
  }

  const filtered = todos.filter(t => {
    if (filter === "active") return !t.isDone;
    if (filter === "completed") return t.isDone;
    return true;
  });

  const priorityColor = (p) => {
    switch (p) {
      case "high": return { bg: "#FFF1F2", color: "#9F1239", darkBg: "#4c0519", darkColor: "#fda4af" };
      case "medium": return { bg: "#FFF7ED", color: "#9A3412", darkBg: "#431407", darkColor: "#fdba74" };
      case "low": return { bg: "#F0FDF4", color: "#166534", darkBg: "#14532d", darkColor: "#86efac" };
      default: return { bg: "#F5F5F5", color: "#666", darkBg: "#333", darkColor: "#aaa" };
    }
  };

  if (showSkeleton) return <div className="todos-page"><TodoSkeleton /></div>;

  return (
    <div className="todos-page">
      {isMobile && sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <div className={`sidebar-wrapper ${isMobile ? "mobile" : ""} ${sidebarOpen ? "open" : ""}`}>
        <Sidebar
          dark={dark} user={user} folders={localFolders} notes={notes.filter(n => !n.teamId)}
          onAllNotes={onGoNotes} onPinned={onGoNotes}
          onLogout={onLogout} toggleDark={toggleDark}
          onGoTeams={() => { onGoTeams(); setSidebarOpen(false); }}
          onGoTodos={() => { setSidebarOpen(false); }}
          onGoProfile={() => { if (onGoProfile) onGoProfile(); setSidebarOpen(false); }}
          onAddFolder={onAddFolder} onFolderDelete={onFolderDelete}
          onFolderOpen={(folderId) => {
            // FIX: Properly navigate to folder detail when clicking folder in sidebar
            if (onFolderOpen) onFolderOpen(folderId);
            setSidebarOpen(false);
          }}
          activeSection="todos"
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <div className="todos-main">
        {isMobile && (
          <div className="todos-mobile-header">
            <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>☰</button>
            <h1>Todos</h1>
            <button className="todos-btn-primary mobile-add-btn" onClick={() => setShowCreate(true)}>+</button>
          </div>
        )}

        <div className="todos-header">
          <h1 className={isMobile ? "mobile-hidden" : ""}>Todos</h1>
          {!isMobile && <button className="todos-btn-primary" onClick={() => setShowCreate(true)}>+ New Todo</button>}
        </div>

        {error && <p className="todos-error">{error}</p>}

        {stats && (
          <div className="todos-stats">
            <div className="todo-stat-card">
              <span className="todo-stat-num">{stats.total || 0}</span>
              <span>Total</span>
            </div>
            <div className="todo-stat-card completed">
              <span className="todo-stat-num">{stats.done || 0}</span>
              <span>Completed</span>
            </div>
            <div className="todo-stat-card active">
              <span className="todo-stat-num">{stats.pending || 0}</span>
              <span>Active</span>
            </div>
            <div className="todo-stat-card overdue">
              <span className="todo-stat-num">{stats.overdue || 0}</span>
              <span>Overdue</span>
            </div>
          </div>
        )}

        <div className="todos-filters">
          {["all", "active", "completed"].map(f => (
            <button
              key={f}
              className={`todos-filter-btn ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f === "all" && ` (${todos.length})`}
              {f === "active" && ` (${todos.filter(t => !t.isDone).length})`}
              {f === "completed" && ` (${todos.filter(t => t.isDone).length})`}
            </button>
          ))}
        </div>

        <div className="todos-list">
          {filtered.length === 0 ? (
            <div className="todos-empty">
              <div className="todos-empty-icon">✅</div>
              <h2>{filter === "all" ? "No todos yet" : `No ${filter} todos`}</h2>
              <p>{filter === "all" ? "Create your first todo to get started." : "Nothing here yet."}</p>
              {filter === "all" && <button className="todos-btn-primary" onClick={() => setShowCreate(true)}>+ Create Todo</button>}
            </div>
          ) : (
            filtered.map(todo => {
              const pc = priorityColor(todo.priority);
              return (
                <div key={todo._id} className={`todo-item ${todo.isDone ? "completed" : ""}`}>
                  <button
                    className={`todo-checkbox ${todo.isDone ? "checked" : ""}`}
                    onClick={() => handleToggle(todo._id)}
                    disabled={toggleMutation.isPending}
                  >
                    {todo.isDone && "✓"}
                  </button>
                  <div className="todo-content">
                    <div className="todo-title-row">
                      <span className={`todo-title ${todo.isDone ? "done" : ""}`}>{todo.title}</span>
                      <span
                        className="todo-priority-badge"
                        style={dark ? { background: pc.darkBg, color: pc.darkColor } : { background: pc.bg, color: pc.color }}
                      >
                        {todo.priority}
                      </span>
                    </div>
                    {todo.description && <p className="todo-description">{todo.description}</p>}
                    <div className="todo-meta">
                      {todo.dueDate && (
                        <span className={`todo-due ${isOverdue(todo.dueDate) && !todo.isDone ? "overdue" : ""}`}>
                          Due: {new Date(todo.dueDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="todo-actions">
                    <button className="todo-action-btn" onClick={() => setEditTodo({ ...todo })}>✏️</button>
                    <button className="todo-action-btn danger" onClick={() => setDeleteTarget(todo._id)}>🗑</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {showCreate && (
        <Modal title="Create New Todo" message="" onConfirm={handleCreate} onCancel={() => { setShowCreate(false); setError(""); }} confirmLabel={createMutation.isPending ? "Creating..." : "Create"}>
          <div className="todo-form">
            <label>Title <span className="required-mark">*</span></label>
            <input value={newTodo.title} onChange={e => setNewTodo({ ...newTodo, title: e.target.value })} placeholder="What needs to be done?" />
            <label>Description</label>
            <textarea value={newTodo.description} onChange={e => setNewTodo({ ...newTodo, description: e.target.value })} placeholder="Additional details..." rows={3} />
            <label>Priority</label>
            <select value={newTodo.priority} onChange={e => setNewTodo({ ...newTodo, priority: e.target.value })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <label>Due Date</label>
            <input type="date" value={newTodo.dueDate} onChange={e => setNewTodo({ ...newTodo, dueDate: e.target.value })} />
          </div>
        </Modal>
      )}

      {editTodo && (
        <Modal title="Edit Todo" message="" onConfirm={handleUpdate} onCancel={() => { setEditTodo(null); setError(""); }} confirmLabel={updateMutation.isPending ? "Saving..." : "Save"}>
          <div className="todo-form">
            <label>Title <span className="required-mark">*</span></label>
            <input value={editTodo.title} onChange={e => setEditTodo({ ...editTodo, title: e.target.value })} />
            <label>Description</label>
            <textarea value={editTodo.description || ""} onChange={e => setEditTodo({ ...editTodo, description: e.target.value })} rows={3} />
            <label>Priority</label>
            <select value={editTodo.priority} onChange={e => setEditTodo({ ...editTodo, priority: e.target.value })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <label>Due Date</label>
            <input type="date" value={editTodo.dueDate ? editTodo.dueDate.split("T")[0] : ""} onChange={e => setEditTodo({ ...editTodo, dueDate: e.target.value })} />
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="Delete this todo?"
          message="This todo will be permanently removed. This cannot be undone."
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
          confirmLabel={deleteMutation.isPending ? "Deleting..." : "Delete"}
          variant="danger"
        />
      )}

      {/* COMBINED FIX #4a: Bottom navigation bar removed.
          Users navigate via the hamburger-menu sidebar (which already
          contains Notes / Teams / Todos / Profile / Log out links). */}
    </div>
  );
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}
