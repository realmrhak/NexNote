/**
 * Socket.io client for real-time collaboration.
 *
 * Connection is established once on first use (singleton). The access token
 * is fetched from the in-memory token store maintained by AuthContext, so
 * the socket stays authenticated as long as the user has a valid session.
 *
 * Reconnection is handled by socket.io itself. On reconnect, the user is
 * expected to re-emit `note:join` / `team:join` for whatever views they're
 * currently on (handled in the respective components via useEffect).
 */
import { io } from "socket.io-client";
import { getAccessToken } from "../context/AuthContext";

// CRITICAL FIX: Socket.io server is mounted on the HTTP server's ROOT path
// (i.e. https://nexnote-api.onrender.com/socket.io/...), NOT under /api.
// But VITE_API_URL is typically set to "https://nexnote-api.onrender.com/api"
// (with the /api suffix). If we pass that directly to io(), the socket client
// tries to connect to "https://nexnote-api.onrender.com/api/socket.io/..." —
// which the backend doesn't handle → connection silently fails → NO real-time
// updates in production (badges don't toggle, logs don't refresh, role changes
// don't propagate). This was the root cause of the "badge doesn't update" bug.
//
// Fix: strip the trailing /api (with optional slash) from VITE_API_URL before
// passing it to io(). In development VITE_API_URL is empty so we fall back to
// "/" — the Vite dev proxy forwards /socket.io → backend automatically.
function getSocketBase() {
  if (import.meta.env.VITE_API_URL) {
    const apiUrl = import.meta.env.VITE_API_URL;
    // Strip trailing slash first, then strip /api suffix
    const trimmed = apiUrl.replace(/\/+$/, "");
    const withoutApi = trimmed.replace(/\/api$/i, "");
    return withoutApi || "/";
  }
  return "/"; // Same origin — works with Vite proxy in dev
}

let _socket = null;
let _connecting = false;

export function getSocket() {
  if (_socket && _socket.connected) return _socket;
  if (_socket) return _socket; // Return existing (connecting) socket
  if (_connecting) return _socket;

  const token = getAccessToken();
  if (!token) {
    // No token — don't try to connect. The caller should re-invoke this
    // after login. We return null so callers can skip subscribing.
    return null;
  }

  _connecting = true;
  const socketBase = getSocketBase();
  console.log("[socket] connecting to:", socketBase, "(VITE_API_URL:", import.meta.env.VITE_API_URL || "empty", ")");
  _socket = io(socketBase, {
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity, // keep trying forever — real-time is critical
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  _socket.on("connect", () => {
    _connecting = false;
    console.log("[socket] ✅ connected — id:", _socket.id);
  });

  _socket.on("connect_error", (err) => {
    _connecting = false;
    console.error("[socket] ❌ connect_error:", err.message, "(base:", socketBase + ")");
    // If unauthorized, the token has expired — caller should re-authenticate
    // via the REST refresh flow, then re-create the socket.
    if (err && /unauthorized/i.test(err.message)) {
      try { _socket.disconnect(); } catch { /* ignore */ }
      _socket = null;
    }
  });

  _socket.on("disconnect", (reason) => {
    console.log("[socket] disconnected — reason:", reason, "— will auto-reconnect");
  });

  _socket.io.on("reconnect", (attempt) => {
    console.log("[socket] 🔄 reconnected after", attempt, "attempts");
  });

  _socket.io.on("reconnect_attempt", (attempt) => {
    console.log("[socket] 🔄 reconnect attempt", attempt);
  });

  return _socket;
}

/**
 * Refresh the socket connection after a token refresh. The previous socket
 * (if any) is disconnected and a new one is created with the new token.
 */
export function refreshSocket() {
  if (_socket) {
    try { _socket.disconnect(); } catch { /* ignore */ }
    _socket = null;
  }
  _connecting = false;
  return getSocket();
}

/**
 * Disconnect the socket entirely (e.g. on logout).
 */
export function destroySocket() {
  if (_socket) {
    try { _socket.disconnect(); } catch { /* ignore */ }
    _socket = null;
  }
  _connecting = false;
}
