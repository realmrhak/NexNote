const express     = require("express");
const helmet      = require("helmet");
const cors        = require("cors");
const morgan      = require("morgan");
const compression = require("compression");
const mongoSanitize = require("express-mongo-sanitize");
const hpp         = require("hpp");

const { globalLimiter, inviteLimiter, passwordResetLimiter } = require("./middleware/rateLimiter");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const logger                     = require("./utils/logger");
const { isSMTPConfigured, isEmailConfigured, verifySMTP, sendTestEmail } = require("./utils/emailUtils");

const authRoutes   = require("./routes/auth");
const noteRoutes   = require("./routes/notes");
const folderRoutes = require("./routes/folders");
const teamRoutes   = require("./routes/teams");
const todoRoutes   = require("./routes/todos");

const app = express();

// SECURITY FIX: Trust proxy headers on Render/Vercel/Nginx so req.ip and the
// rate limiter's keyGenerator pick up the REAL client IP from X-Forwarded-For
// instead of the proxy's IP (which would mean ALL requests share one bucket).
// "1" trusts the first proxy hop — correct for Render (one hop) and most CDNs.
app.set("trust proxy", 1);

// PERF FIX: Enable ETag support — Express generates weak ETags by default for
// JSON responses. Combined with React Query's staleTime on the client, this
// means a repeat GET to /api/notes/tags within the cache window returns a 304
// (no body) instead of a full 200 — saving bandwidth and parsing time.
app.set("etag", "weak");

// Read version from package.json
let version = "unknown";
try {
  version = require("./package.json").version;
} catch (e) { /* ignore */ }

// ─── Security headers ─────────────────────────────────────────────────────────
// Helmet with strict CSP, HSTS preload, COOP, X-Frame-Options DENY.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "https:"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: "same-site" },
  crossOriginOpenerPolicy:   { policy: "same-origin" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  xFrameOptions: { action: "deny" },
  xContentTypeOptions: true,
  xDnsPrefetchControl: { allow: false },
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",").map((o) => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow same-origin / curl / mobile
    if (allowedOrigins.includes(origin)) return cb(null, true);
    if (process.env.NODE_ENV !== "production" && (origin.includes("localhost") || origin.includes("127.0.0.1"))) return cb(null, true);
    logger.warn(`CORS blocked origin: ${origin}`);
    cb(new Error(`CORS: origin not allowed`));
  },
  credentials:    true,
  methods:        ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// ─── Parsing + compression ────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// SECURITY FIX: Sanitize user-supplied data against NoSQL injection ($where,
// $gt, etc.) — strips $-prefixed keys from req.body, req.query, req.params.
// Must run AFTER body parsing.
app.use(mongoSanitize());

// SECURITY FIX: HTTP Parameter Pollution protection — collapses ?a=1&a=2 to a
// single value (last wins) so attackers can't bypass validators that expect a
// scalar by sending an array.
app.use(hpp());

app.use(compression());

// ─── Cache-Control for stable GET endpoints ───────────────────────────────────
// PERF FIX: Bumped cache times — tags & folders are read-heavy and rarely
// change. Combined with React Query's staleTime on the client, this
// dramatically reduces repeat API calls for the same user.
app.use("/api/notes/tags", (_req, res, next) => { res.set("Cache-Control", "private, max-age=120, stale-while-revalidate=300"); next(); });
app.use("/api/folders",    (_req, res, next) => { res.set("Cache-Control", "private, max-age=120, stale-while-revalidate=300"); next(); });
app.use("/api/teams",      (_req, res, next) => { res.set("Cache-Control", "private, max-age=60,  stale-while-revalidate=120"); next(); });

// ─── Logging ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("combined", { stream: { write: (m) => logger.http(m.trim()) } }));
}

// ─── AUTH FIX #2: Lightweight ping endpoint — MUST be mounted BEFORE the
// global rate limiter so that keep-alive pings don't count against the
// user's per-IP request budget. Without this, a few minutes of pings would
// push normal users over the limit and trigger 429 on real requests.
app.get("/api/ping", (_req, res) => {
  res.status(200).json({
    success: true,
    status: "ok",
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
});

// ─── Rate limit ───────────────────────────────────────────────────────────────
app.use("/api", globalLimiter);

// ─── Health check (no auth needed) ────────────────────────────────────────────
app.get("/api/health", (_req, res) =>
  res.json({
    success: true,
    status: "ok",
    version,
    buildTag: "round-6-todo-form-css", // VERSION MARKER — check this to verify deployment
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
);

// ─── Test route (no auth, for debugging) ──────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.post("/api/test", (_req, res) =>
    res.json({ success: true, message: "API is working!", body: _req.body })
  );
}

// ─── SMTP status & test (no auth, for debugging email setup) ─────────────────
app.get("/api/smtp-status", async (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.json({ configured: isEmailConfigured(), provider: 'hidden' });
  }
  if (!isEmailConfigured()) {
    return res.json({
      configured: false,
      message: "SMTP is not configured. Set SMTP_USER (your Gmail address) and SMTP_PASS (your 16-char Gmail App Password — NOT your regular Gmail password) in backend/.env. Team invites will be saved but emails will NOT be sent.",
      hint: "1) Enable 2-Step Verification on your Google account 2) Generate an App Password at https://myaccount.google.com/apppasswords 3) Set SMTP_USER=your-email@gmail.com and SMTP_PASS=your-16-char-app-password (remove spaces)",
    });
  }
  const verification = await verifySMTP();
  if (verification.ok) {
    return res.json({
      configured: true,
      provider: "smtp",
      connected: true,
      message: "SMTP is configured and connected. Invite emails will be sent.",
      smtp_user: process.env.SMTP_USER,
      smtp_host: process.env.SMTP_HOST || "smtp.gmail.com",
      smtp_port: process.env.SMTP_PORT || 587,
      email_from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    });
  }
  return res.json({
    configured: true,
    provider: "smtp",
    connected: false,
    message: "SMTP credentials are set but connection FAILED. Check SMTP_USER, SMTP_PASS, and SMTP_HOST.",
    error: verification.error,
    hint: "Common issues: 1) Wrong App Password (use App Password, NOT regular Gmail password) 2) 2-Step Verification not enabled 3) Gmail blocking the sign-in 4) Wrong SMTP_HOST",
  });
});

// ─── Send test email (POST with { to: "email@example.com" }) ──────────────
app.post("/api/smtp-test-send", async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ success: false, message: "Not available in production" });
  }
  const toEmail = req.body.to;
  if (!toEmail) {
    return res.status(400).json({ success: false, message: "Provide 'to' email in request body. Example: { \"to\": \"you@gmail.com\" }" });
  }
  const result = await sendTestEmail(toEmail);
  if (result.sent) {
    return res.json({ success: true, message: `Test email sent to ${toEmail}. Check inbox AND spam folder.`, messageId: result.messageId });
  }
  return res.json({ success: false, message: "Failed to send test email.", error: result.reason });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/auth",    authRoutes);
app.use("/api/notes",   noteRoutes);
app.use("/api/folders", folderRoutes);
app.use("/api/teams",   teamRoutes);
app.use("/api/todos",   todoRoutes);

// ─── Error handling ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;
