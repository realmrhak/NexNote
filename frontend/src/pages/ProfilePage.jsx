import { useState } from "react";
import toast from "react-hot-toast";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { authAPI } from "../services/api";
import "../styles/profile.css";

/**
 * COMBINED FIX #2: Dedicated Profile Settings page.
 *
 * Users can:
 *   - Update their display name (calls PATCH /api/auth/me)
 *   - Change their password (calls POST /api/auth/change-password)
 *
 * Both endpoints already exist on the backend (see controllers/authController.js
 * and services/authService.js — `updateProfile` and `changePassword`).
 *
 * After a successful password change, the backend invalidates the user's
 * refresh token, so we automatically log them out and bounce them to the
 * auth page.
 */
export default function ProfilePage({
  dark, user: userProp, notes, folders, onBack, toggleDark, onLogout,
  onGoNotes, onGoTeams, onGoTodos, onGoProfile, onAddFolder, onFolderDelete, onFolderOpen,
  onRefresh,
}) {
  // Prefer the user from AuthContext (it stays in sync after a name change)
  const { user: authUser, updateProfile: updateAuthProfile, logout } = useAuth();
  const user = authUser || userProp;

  // ─── Name change state ────────────────────────────────────────────────────
  const [name, setName] = useState(user?.name || "");
  const [nameLoading, setNameLoading] = useState(false);

  // ─── Password change state ────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passLoading, setPassLoading] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Mobile sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile] = useState(typeof window !== "undefined" ? window.innerWidth < 768 : false);

  async function handleNameUpdate() {
    if (!name.trim()) {
      toast.error("Name cannot be empty");
      return;
    }
    if (name.trim().length < 2) {
      toast.error("Name must be at least 2 characters");
      return;
    }
    try {
      setNameLoading(true);
      await updateAuthProfile({ name: name.trim() });
      toast.success("Name updated!");
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to update name";
      toast.error(msg);
    } finally {
      setNameLoading(false);
    }
  }

  async function handlePasswordUpdate() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("Please fill in all password fields");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirm password do not match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      toast.error("Password must contain at least one letter and one number");
      return;
    }
    try {
      setPassLoading(true);
      await authAPI.changePassword({ currentPassword, newPassword });
      toast.success("Password changed! Please log in again.");
      // Backend invalidated the refresh token — log out and bounce to auth page.
      setTimeout(() => {
        logout();
      }, 1500);
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to change password";
      toast.error(msg);
    } finally {
      setPassLoading(false);
    }
  }

  return (
    <div className="profile-page">
      {isMobile && sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      <div className={`sidebar-wrapper ${isMobile ? "mobile" : ""} ${sidebarOpen ? "open" : ""}`}>
        <Sidebar
          dark={dark} user={user} folders={folders || []} notes={notes || []}
          onAllNotes={onGoNotes} onPinned={onGoNotes}
          onLogout={onLogout} toggleDark={toggleDark}
          onGoTeams={onGoTeams} onGoTodos={onGoTodos}
          onGoProfile={onGoProfile}
          onAddFolder={onAddFolder} onFolderDelete={onFolderDelete}
          onFolderOpen={(folderId) => { if (onFolderOpen) onFolderOpen(folderId); setSidebarOpen(false); }}
          activeSection="profile"
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      <div className="profile-main">
        {isMobile && (
          <div className="profile-mobile-header">
            <button className="mobile-menu-btn" onClick={() => setSidebarOpen(true)}>☰</button>
            <h1>Profile</h1>
            <div style={{ width: 36 }} />
          </div>
        )}

        <button className="profile-back-btn" onClick={onBack}>← Back</button>

        <div className="profile-header">
          <div className="profile-avatar-lg">{(user?.name || "U")[0].toUpperCase()}</div>
          <div>
            <h1>{user?.name || "User"}</h1>
            <p className="profile-email">{user?.email}</p>
          </div>
        </div>

        {/* ─── Name Change Card ─────────────────────────────────────────── */}
        <div className="profile-card">
          <h2>Display Name</h2>
          <p className="profile-card-hint">This is the name other team members will see.</p>
          <div className="profile-field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              maxLength={60}
              onKeyDown={e => { if (e.key === "Enter") handleNameUpdate(); }}
            />
          </div>
          <button
            className="profile-btn-primary"
            onClick={handleNameUpdate}
            disabled={nameLoading || name.trim() === (user?.name || "")}
          >
            {nameLoading ? "Updating…" : "Update Name"}
          </button>
        </div>

        {/* ─── Password Change Card ────────────────────────────────────── */}
        <div className="profile-card">
          <h2>Change Password</h2>
          <p className="profile-card-hint">
            After changing your password, you'll be logged out and need to sign in again.
          </p>

          <div className="profile-field">
            <label>Current Password</label>
            <div className="profile-password-wrapper">
              <input
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
              />
              <button
                type="button"
                className="profile-password-toggle"
                onClick={() => setShowCurrent(s => !s)}
                tabIndex={-1}
                aria-label={showCurrent ? "Hide password" : "Show password"}
              >
                {showCurrent ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
          </div>

          <div className="profile-field">
            <label>New Password</label>
            <div className="profile-password-wrapper">
              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 8 chars, 1 letter + 1 number"
              />
              <button
                type="button"
                className="profile-password-toggle"
                onClick={() => setShowNew(s => !s)}
                tabIndex={-1}
                aria-label={showNew ? "Hide password" : "Show password"}
              >
                {showNew ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
          </div>

          <div className="profile-field">
            <label>Confirm New Password</label>
            <div className="profile-password-wrapper">
              <input
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                onKeyDown={e => { if (e.key === "Enter") handlePasswordUpdate(); }}
              />
              <button
                type="button"
                className="profile-password-toggle"
                onClick={() => setShowConfirm(s => !s)}
                tabIndex={-1}
                aria-label={showConfirm ? "Hide password" : "Show password"}
              >
                {showConfirm ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
          </div>

          <button
            className="profile-btn-primary"
            onClick={handlePasswordUpdate}
            disabled={passLoading || !currentPassword || !newPassword || !confirmPassword}
          >
            {passLoading ? "Changing…" : "Change Password"}
          </button>
        </div>

        {/* ─── Danger Zone ─────────────────────────────────────────────── */}
        <div className="profile-card danger">
          <h2>Session</h2>
          <p className="profile-card-hint">Log out from this device. You can log back in anytime.</p>
          <button className="profile-btn-danger" onClick={logout}>
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
