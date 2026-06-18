import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { authAPI, teamsAPI } from "../services/api";
import { destroySocket } from "../services/socket";
import toast from "react-hot-toast";

const AuthContext = createContext(null);

// ─── In-memory token store ────────────────────────────────────────────────────
// Access token lives ONLY in memory — not in localStorage — so XSS cannot steal it.
// Refresh token is persisted in localStorage for session continuity across tab refreshes.
let _accessToken = null;

export function getAccessToken()  { return _accessToken; }
export function setAccessToken(t) { _accessToken = t; }
export function clearAccessToken() { _accessToken = null; }

export function AuthProvider({ children }) {
  const [user, setUser]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [screen, setScreen]       = useState("auth"); // "auth" | "dashboard" | "editor" | "teams" | "todos" | "folderDetail"
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);

  const INACTIVITY_TIMEOUT = 28 * 60 * 1000; // 28 min — show warning
  const LOGOUT_TIMEOUT = 30 * 60 * 1000; // 30 min — auto logout
  const inactivityRef = useRef(null);
  const logoutRef = useRef(null);

  const resetInactivityTimer = useCallback(() => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    if (logoutRef.current) clearTimeout(logoutRef.current);
    setShowTimeoutWarning(false);
    if (user) {
      inactivityRef.current = setTimeout(() => setShowTimeoutWarning(true), INACTIVITY_TIMEOUT);
      logoutRef.current = setTimeout(() => {
        authAPI.logout().catch(() => {});
        clearAccessToken();
        localStorage.removeItem("nexnote_refresh_token");
        destroySocket();
        setUser(null);
        setScreen("auth");
        setShowTimeoutWarning(false);
      }, LOGOUT_TIMEOUT);
    }
  }, [user]);

  // ─── Pending invite token management ───────────────────────────────────────
  const storePendingInvite = useCallback((token) => {
    sessionStorage.setItem("nexnote_pending_invite", token);
  }, []);

  const clearPendingInvite = useCallback(() => {
    sessionStorage.removeItem("nexnote_pending_invite");
  }, []);

  // ─── Auto-accept pending invite ────────────────────────────────────────────
  // After login/register/session-restore, if there's a stored invite token, accept it automatically
  const autoAcceptInvite = useCallback(async () => {
    const token = sessionStorage.getItem("nexnote_pending_invite");
    if (!token) return;
    try {
      const team = await teamsAPI.acceptInvite(token);
      clearPendingInvite();
      setScreen("teams"); // Navigate to teams page so user sees their new team
      toast.success("You have joined the team!");
      return team;
    } catch (err) {
      clearPendingInvite();
      toast.error(err.response?.data?.message || "Failed to accept invite. It may have expired.");
    }
  }, [clearPendingInvite]);

  // ─── On mount: try to restore session from stored tokens ────────────────────
  // AUTH FIX #2/#3: If the refresh fails because the server is unreachable
  // (Render cold start), we DON'T silently log the user out — we leave the
  // refresh token in localStorage and just set `loading: false` so the user
  // sees the auth page. They can hit "Log In" again, which will succeed once
  // the server is awake (and the keep-alive ping has warmed it up).
  useEffect(() => {
    (async () => {
      const refreshToken = localStorage.getItem("nexnote_refresh_token");
      if (!refreshToken) { setLoading(false); return; }

      // Try to get a fresh access token using the refresh token
      try {
        const tokens = await authAPI.refresh(refreshToken);
        setAccessToken(tokens.accessToken);
        localStorage.setItem("nexnote_refresh_token", tokens.refreshToken);
        const userData = await authAPI.getMe();
        setUser(userData);
        setScreen("dashboard");

        // ─── BUG 2 FIX: Auto-accept pending invite after session restoration ──
        // Previously, autoAcceptInvite was only called from login/register.
        // If a user clicked an invite link while already having a session,
        // the token was stored in sessionStorage but never processed.
        autoAcceptInvite();
      } catch (err) {
        // AUTH FIX #2: Distinguish between "refresh token invalid" (401/403)
        // and "server unreachable" (network error / 503). Only clear the
        // stored tokens if the SERVER explicitly rejected them — not if we
        // just couldn't reach the server.
        const status = err?.response?.status;
        const isServerRejected = status === 401 || status === 403;
        const isServerUnreachable =
          err?.code === "ERR_NETWORK" ||
          err?.code === "ECONNABORTED" ||
          status === 503 ||
          !err?.response;

        if (isServerRejected) {
          // Refresh token expired or revoked — clear and force re-login.
          clearAccessToken();
          localStorage.removeItem("nexnote_refresh_token");
          destroySocket();
        } else if (isServerUnreachable) {
          // Server is sleeping or unreachable — keep the refresh token so
          // we can retry on the next page load. Don't log the user out.
          // The keep-alive ping will warm the server; once it's up, the
          // user can click "Log In" and the session will be restored.
          console.warn("[AuthContext] Could not reach server during session restore — keeping refresh token for retry.");
          clearAccessToken(); // clear in-memory token (will be refetched on next login attempt)
        } else {
          // Unknown error — be safe and clear everything.
          clearAccessToken();
          localStorage.removeItem("nexnote_refresh_token");
          destroySocket();
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Inactivity timer ──────────────────────────────────────────────────────
  useEffect(() => {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const handler = () => resetInactivityTimer();
    events.forEach(e => window.addEventListener(e, handler));
    resetInactivityTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, handler));
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      if (logoutRef.current) clearTimeout(logoutRef.current);
    };
  }, [resetInactivityTimer]);

  // ─── Login ──────────────────────────────────────────────────────────────────
  const login = useCallback(async ({ email, password }) => {
    const result = await authAPI.login({ email, password });
    setAccessToken(result.accessToken);
    localStorage.setItem("nexnote_refresh_token", result.refreshToken);
    setUser(result.user);
    setScreen("dashboard");
    // Auto-accept pending invite after login (non-blocking)
    autoAcceptInvite();
    return result.user;
  }, [autoAcceptInvite]);

  // ─── Register ───────────────────────────────────────────────────────────────
  const register = useCallback(async ({ name, email, password }) => {
    const result = await authAPI.register({ name, email, password });
    setAccessToken(result.accessToken);
    localStorage.setItem("nexnote_refresh_token", result.refreshToken);
    setUser(result.user);
    setScreen("dashboard");
    // Auto-accept pending invite after registration (non-blocking)
    autoAcceptInvite();
    return result.user;
  }, [autoAcceptInvite]);

  // ─── Logout ─────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try { await authAPI.logout(); } catch {}
    clearAccessToken();
    localStorage.removeItem("nexnote_refresh_token");
    // BUG #3/#4 FIX: Tear down the Socket.io connection so stale listeners
    // don't fire after logout and so the next user starts with a clean socket.
    destroySocket();
    setUser(null);
    setScreen("auth");
    setShowTimeoutWarning(false);
  }, []);

  // ─── Update profile ─────────────────────────────────────────────────────────
  const updateProfile = useCallback(async (data) => {
    const updated = await authAPI.updateProfile(data);
    setUser(updated);
    return updated;
  }, []);

  // ─── Refresh current user (used by global socket listener) ─────────────────
  // REAL-TIME FIX: When the user's OWN role is changed by a team owner
  // (promoted to admin or demoted to member), the global socket listener
  // (useGlobalTeamSocket in App.jsx) calls this to refresh the cached user
  // object so the sidebar / permissions / admin-only actions update
  // immediately — no manual page reload required.
  const refreshUser = useCallback(async () => {
    try {
      const fresh = await authAPI.getMe();
      setUser(fresh);
      return fresh;
    } catch {
      // best-effort — if the fetch fails, the user object stays as-is.
      // The next manual navigation will trigger a refresh anyway.
      return null;
    }
  }, []);

  // ─── Dismiss timeout warning (resets timer) ─────────────────────────────────
  const dismissTimeoutWarning = useCallback(() => {
    resetInactivityTimer();
  }, [resetInactivityTimer]);

  return (
    <AuthContext.Provider value={{ user, loading, screen, setScreen, login, register, logout, updateProfile, refreshUser, showTimeoutWarning, dismissTimeoutWarning, autoAcceptInvite, storePendingInvite, clearPendingInvite }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
