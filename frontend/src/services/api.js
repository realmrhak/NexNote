import axios from "axios";
import { getAccessToken, setAccessToken, clearAccessToken } from "../context/AuthContext";
import { destroySocket } from "./socket";

// PERFORMANCE/ BUILD FIX: Previously this module lazy-imported ./socket via
// `await import("./socket")` to break a (now non-existent) circular dep.
// Vite 5 emits a build warning when the SAME module is both statically and
// dynamically imported, because the dynamic import can no longer move the
// module into a separate chunk. Since AuthContext no longer imports socket
// directly (it goes through services/socket.js), we can statically import
// destroySocket here without forming a cycle. This removes the warning and
// also lets Vite properly tree-shake the socket module.
function destroySocketLazy() {
  try { destroySocket(); } catch { /* ignore — socket module optional */ }
}

// ─── API Base URL ──────────────────────────────────────────────────────────────
// Priority: 1. VITE_API_URL env var  2. Relative path (Vite proxy)  3. Auto-detect
// Using relative "/api" path works with Vite dev proxy AND Nginx reverse proxy
// without hardcoding any port number.
function getApiBase() {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;
  // Use relative path — works with Vite proxy in dev and Nginx in production
  // The Vite proxy (vite.config.js) forwards /api → backend
  // Nginx does the same in production
  return "/api";
}

const API_BASE = getApiBase();

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: false,
  headers: { "Content-Type": "application/json" },
  // AUTH FIX #2: Bump the timeout from 10s to 30s so requests don't fail
  // prematurely when the Render free-tier server is cold-starting (50-90s
  // total boot time, but the first few requests after wake can take 10-20s
  // while the Node process warms up).
  timeout: 30000,
});

// ─── Request interceptor: attach in-memory access token ───────────────────────
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── Response interceptor: auto-refresh on 401 + retry on cold-start ──────────
//
// AUTH FIX #1 (v2): `isRefreshing` guard. Without this, multiple concurrent
// 401 responses (e.g., a dashboard that fires 5 API calls in parallel when
// the access token has just expired) would each independently trigger a
// /auth/refresh call. The second refresh would invalidate the first's
// refreshToken (server rotates it), causing the FIRST refresh's response to
// become stale → next request 401s again → another refresh → infinite loop
// that hammers the server and quickly trips the 429 rate limit.
//
// With the guard: the first 401 starts a single refresh. All other 401'd
// requests queue on `refreshPromise` and resume once the refresh resolves.
let isRefreshing = false;
let refreshPromise = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    // AUTH FIX #2: If the request failed due to a network error (no response
    // at all) OR a 503 (server explicitly says it's unavailable), retry up
    // to TWO times with a 3-second delay between attempts. This handles the
    // "Render cold start" case where the first request after a long idle
    // period hits a sleeping server.
    const isNetworkError =
      !error.response &&
      (error.code === "ERR_NETWORK" || error.code === "ECONNABORTED");
    const isServiceUnavailable = error.response?.status === 503;

    if ((isNetworkError || isServiceUnavailable) && !original._coldStartRetried) {
      original._coldStartRetried = true;
      // Wait 3 seconds before retrying — gives the server time to wake up.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return api(original);
    }

    // AUTH FIX #1 (v2): Friendly toast on 429 — tell the user instead of
    // silently failing.
    if (error.response?.status === 429) {
      const retryAfter = error.response.headers?.["retry-after"];
      const mins = retryAfter ? Math.ceil(parseInt(retryAfter, 10) / 60) : "a few";
      // Lazy-import toast to avoid circular deps in build
      import("react-hot-toast").then(({ default: toast }) => {
        toast.error(`Too many attempts — please try again in ${mins} minute(s).`);
      });
    }

    // ─── Auto-refresh on 401 ──────────────────────────────────────────────────
    if (
      error.response?.status === 401 &&
      !original._retry &&
      !original.url?.includes("/auth/login") &&
      !original.url?.includes("/auth/register") &&
      !original.url?.includes("/auth/refresh")
    ) {
      // AUTH FIX #1 (v2): If a refresh is already in flight, piggy-back on it.
      if (isRefreshing && refreshPromise) {
        try {
          const tokens = await refreshPromise;
          original.headers.Authorization = `Bearer ${tokens.accessToken}`;
          return api(original);
        } catch (refreshErr) {
          return Promise.reject(refreshErr);
        }
      }

      original._retry = true;
      isRefreshing = true;

      refreshPromise = (async () => {
        try {
          const refreshToken = localStorage.getItem("nexnote_refresh_token");
          if (!refreshToken) throw new Error("No refresh token");
          const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken });
          // Store new access token in MEMORY only (not localStorage)
          setAccessToken(data.data.accessToken);
          // Persist refresh token in localStorage for tab continuity
          localStorage.setItem("nexnote_refresh_token", data.data.refreshToken);
          return data.data;
        } catch (refreshErr) {
          clearAccessToken();
          localStorage.removeItem("nexnote_refresh_token");
          // BUG #3/#4 FIX: Tear down the socket on auth failure so stale
          // listeners don't keep firing after the user has been logged out.
          destroySocketLazy();
          // AUTH FIX #3: Don't redirect to "/" if the refresh failed because
          // the server was unreachable — that just bounces the user around
          // while the server is cold-starting. Only redirect on real auth
          // failures (401/403 from the refresh endpoint itself).
          const refreshStatus = refreshErr?.response?.status;
          const wasServerRejected = refreshStatus === 401 || refreshStatus === 403;
          if (wasServerRejected) {
            window.location.href = "/";
          }
          throw refreshErr;
        } finally {
          isRefreshing = false;
          refreshPromise = null;
        }
      })();

      try {
        const tokens = await refreshPromise;
        original.headers.Authorization = `Bearer ${tokens.accessToken}`;
        return api(original);
      } catch (refreshErr) {
        return Promise.reject(refreshErr);
      }
    }
    return Promise.reject(error);
  }
);

// ─── Helper: extract data from API response ───────────────────────────────────
function extract(res) {
  return res.data?.data;
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  register:  (data) => api.post("/auth/register", data).then(extract),
  login:     (data) => api.post("/auth/login", data).then(extract),
  refresh:   (refreshToken) => api.post("/auth/refresh", { refreshToken }).then(extract),
  logout:    () => api.post("/auth/logout").then(extract),
  getMe:     () => api.get("/auth/me").then(extract),
  updateProfile: (data) => api.patch("/auth/me", data).then(extract),
  changePassword: (data) => api.post("/auth/change-password", data).then(extract),
};

// ─── Notes ─────────────────────────────────────────────────────────────────────
export const notesAPI = {
  getAll:       (params) => api.get("/notes", { params }).then(extract),
  getById:      (id) => api.get(`/notes/${id}`).then(extract),
  create:       (data) => api.post("/notes", data).then(extract),
  update:       (id, data) => api.patch(`/notes/${id}`, data).then(extract),
  delete:       (id) => api.delete(`/notes/${id}`).then(() => true),
  togglePin:    (id) => api.patch(`/notes/${id}/pin`).then(extract),
  share:        (id) => api.post(`/notes/${id}/share`).then(extract),
  unshare:      (id) => api.delete(`/notes/${id}/share`).then(extract),
  getShared:    (token) => api.get(`/notes/shared/${token}`).then(extract),
  getTags:      () => api.get("/notes/tags").then(extract),
};

// ─── Folders ───────────────────────────────────────────────────────────────────
export const foldersAPI = {
  getAll:    (params) => api.get("/folders", { params }).then(extract),
  getById:   (id) => api.get(`/folders/${id}`).then(extract),
  create:    (data) => api.post("/folders", data).then(extract),
  update:    (id, data) => api.patch(`/folders/${id}`, data).then(extract),
  delete:    (id) => api.delete(`/folders/${id}`).then(() => true),
};

// ─── Teams ─────────────────────────────────────────────────────────────────────
export const teamsAPI = {
  getMyTeams:     () => api.get("/teams").then(extract),
  getById:        (id) => api.get(`/teams/${id}`).then(extract),
  create:         (data) => api.post("/teams", data).then(extract),
  update:         (id, data) => api.patch(`/teams/${id}`, data).then(extract),
  delete:         (id) => api.delete(`/teams/${id}`).then(() => true),
  inviteMember:   (teamId, data) => api.post(`/teams/${teamId}/invites`, data).then(extract),
  acceptInvite:   (token) => api.post(`/teams/invites/${token}/accept`).then(extract),
  cancelInvite:   (teamId, email) => api.delete(`/teams/${teamId}/invites`, { data: { email } }).then(() => true),
  removeMember:   (teamId, userId) => api.delete(`/teams/${teamId}/members/${userId}`).then(() => true),
  updateMemberRole: (teamId, userId, role) => api.patch(`/teams/${teamId}/members/${userId}/role`, { role }).then(extract),
  // FIX #3 (v2): updateMemberStatus removed — member status field no longer exists.
  getStats:       (teamId) => api.get(`/teams/${teamId}/stats`).then(extract),
  // FEATURE: Activity logs — admin sees all logs; non-admin members see only
  // their own entries (enforced server-side).
  getLogs:        (teamId, params) => api.get(`/teams/${teamId}/logs`, { params }).then(res => {
    // Endpoint returns { success, message, data: [...logs], meta: {...} }
    const data = res.data?.data;
    const meta = res.data?.meta;
    if (Array.isArray(data)) {
      // Attach meta to the array for callers that want it (e.g., isAdmin flag)
      data._meta = meta;
      return data;
    }
    return data;
  }),
  smtpStatus:     () => api.get("/smtp-status").then(res => res.data),
};

// ─── Todos ─────────────────────────────────────────────────────────────────────
export const todosAPI = {
  getAll:    (params) => api.get("/todos", { params }).then(extract),
  getById:   (id) => api.get(`/todos/${id}`).then(extract),
  create:    (data) => api.post("/todos", data).then(extract),
  update:    (id, data) => api.patch(`/todos/${id}`, data).then(extract),
  delete:    (id) => api.delete(`/todos/${id}`).then(() => true),
  toggle:    (id) => api.patch(`/todos/${id}/toggle`).then(extract),
  getStats:  (params) => api.get("/todos/stats", { params }).then(extract),
};

// Export base URL for debugging
export { API_BASE };

export default api;
