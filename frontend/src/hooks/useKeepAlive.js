/**
 * AUTH FIX #2: Keep the backend warm on Render's free tier.
 *
 * Render's free tier spins down the server after ~15 minutes of inactivity,
 * and cold-starting takes 50-90 seconds. Without a keep-alive ping, the user
 * sees "Cannot reach server" errors when they log in after a period of
 * inactivity — and even when they DO log in, the first notes/folders fetch
 * often fails because the server hasn't fully booted yet.
 *
 * This hook pings `/api/ping` every 4 minutes from the moment the app mounts.
 * Pings are unauthenticated and outside the rate limiter (see backend app.js),
 * so they don't impact any user-facing budget. Failed pings are silently
 * swallowed — we don't want to spam toasts every 4 minutes if the user's
 * internet drops.
 *
 * Usage:
 *   // Inside AppInner (root component):
 *   useKeepAlive();
 *
 * The hook cleans up its interval on unmount.
 */
import { useEffect } from "react";

const PING_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes

export function useKeepAlive() {
  useEffect(() => {
    // Resolve the same API base that `services/api.js` uses — relative "/api"
    // in dev (proxied by Vite) and prod (proxied by Nginx), or the explicit
    // VITE_API_URL when set.
    const apiBase = import.meta.env.VITE_API_URL || "/api";
    const pingUrl = apiBase.endsWith("/")
      ? `${apiBase}ping`
      : `${apiBase}/ping`;

    const keepAlive = () => {
      // Use a bare fetch (not axios) so we don't trigger the global 401
      // interceptor or any auth-header logic. We don't care about the
      // response body — we just want to wake the server.
      fetch(pingUrl, { method: "GET", mode: "no-cors" })
        .then(() => {
          /* success — server is alive. Nothing else to do. */
        })
        .catch(() => {
          /* network error — silently ignore. Don't spam the console. */
        });
    };

    // Ping immediately on mount — covers the "user opens the app for the
    // first time after a long break" case where the server is asleep.
    keepAlive();

    const interval = setInterval(keepAlive, PING_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);
}
