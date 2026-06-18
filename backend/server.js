require("dotenv").config();

const app       = require("./app");
const connectDB = require("./config/db");
const { ensureNotesIndexes } = require("./config/db");
const logger    = require("./utils/logger");
const { initSockets } = require("./sockets");

// ─── Startup validation: ensure critical env vars exist ────────────────────────
const requiredEnvVars = ["JWT_SECRET", "JWT_REFRESH_SECRET", "MONGODB_URI"];
const missing = requiredEnvVars.filter((v) => !process.env[v]);
if (missing.length) {
  logger.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const PORT = parseInt(process.env.PORT, 10) || 5001;

// Read version from package.json
let version = "unknown";
try {
  version = require("./package.json").version;
} catch (e) { /* ignore */ }

// BUG #3/#4 FIX: Build the same CORS origin resolver used by Express so the
// Socket.io server uses identical origin rules. Kept here to avoid a circular
// import with app.js.
function corsOriginResolver(origin, cb) {
  if (!origin) return cb(null, true);
  const allowedOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "http://localhost:5173")
    .split(",").map((o) => o.trim()).filter(Boolean);
  if (allowedOrigins.includes(origin)) return cb(null, true);
  if (process.env.NODE_ENV !== "production" && (origin.includes("localhost") || origin.includes("127.0.0.1"))) {
    return cb(null, true);
  }
  return cb(new Error("CORS: origin not allowed"));
}

async function start() {
  await connectDB();

  // BUG 1 FIX: Repair the shareToken index BEFORE the server starts listening.
  // The previous implementation ran this on the mongoose "open" event, which
  // fires asynchronously after `mongoose.connect()` resolves — meaning
  // `app.listen()` could start serving requests before the index was repaired,
  // so the first few POST /api/notes calls still hit the bad index and failed
  // with E11000. Awaiting it here guarantees the index is correct before any
  // request can reach the API.
  await ensureNotesIndexes();

  const server = app.listen(PORT, () => {
    logger.info(`NexNote API v${version} running on port ${PORT} [${process.env.NODE_ENV || "development"}]`);
  });

  // BUG #3/#4 FIX: Attach Socket.io to the SAME HTTP server so a single port
  // serves both REST and WebSocket traffic. This avoids CORS/transport issues
  // on Render/Vercel/Nginx where a separate port would be blocked.
  const io = initSockets(server, corsOriginResolver);
  // Expose io on app.locals so route handlers / services can broadcast events
  // (e.g. todoService can emit `todo:toggled` after a REST toggle).
  app.set("io", io);
  logger.info("Socket.io server attached (real-time collaboration enabled)");

  function shutdown(signal) {
    logger.info(`${signal} — shutting down gracefully…`);
    try { io.close(); } catch { /* ignore */ }
    server.close(async () => {
      await require("mongoose").connection.close();
      logger.info("Closed. Bye.");
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("unhandledRejection", (r) => { logger.error(`Unhandled rejection: ${r}`); shutdown("unhandledRejection"); });
}

start();
