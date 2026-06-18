import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` (development/production)
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // REST API
        "/api": {
          // Use VITE_API_URL if set, otherwise detect from backend PORT env var, default 5001
          target: env.VITE_API_URL || `http://localhost:${env.BACKEND_PORT || 5001}`,
          changeOrigin: true,
          secure: false,
        },
        // BUG #3/#4 FIX: WebSocket proxy for Socket.io. Without this, dev-mode
        // sockets try to connect to the Vite dev server (port 5173) and fail.
        // The /socket.io path (default for socket.io) is forwarded to the
        // backend with WebSocket upgrade support.
        "/socket.io": {
          target: env.VITE_API_URL || `http://localhost:${env.BACKEND_PORT || 5001}`,
          changeOrigin: true,
          secure: false,
          ws: true, // Enable WebSocket proxying
        },
      },
    },
    build: {
      // PERF FIX: Optimized code splitting for smaller bundles and faster initial load
      rollupOptions: {
        output: {
          manualChunks: {
            // Core React — rarely changes, long cache
            'vendor-react': ['react', 'react-dom'],
            // Data fetching — changes infrequently
            'vendor-query': ['@tanstack/react-query'],
            // HTTP + utilities — small and stable
            'vendor-utils': ['axios', 'react-hot-toast'],
            // BUG #3/#4 FIX: Socket.io client is heavy — split it into its own chunk
            // so it doesn't bloat the main bundle for users who only browse notes.
            'vendor-socket': ['socket.io-client'],
          },
        },
      },
      // Enable minification (esbuild is built-in, no extra install needed)
      minify: 'esbuild',
      // Set chunk size warning limit
      chunkSizeWarningLimit: 500,
    },
    // Enable source maps in development only
    sourcemap: mode === 'development',
  };
});
