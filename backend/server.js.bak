/**
 * Kadem & Zetu School Management System — Express Server v4.2
 * Production-hardened: Helmet, CORS whitelist, rate limiting,
 * global error handler, graceful shutdown, crash guards
 */
"use strict";
require("dotenv").config();

// ── Global crash guards — MUST be first ──────────────────────────
// Prevent one bad async handler from taking down the entire process
process.on("uncaughtException", (err) => {
  console.error(`[FATAL] uncaughtException at ${new Date().toISOString()}:`, err.message, err.stack);
  // Give logger time to flush, then exit so the process manager (Render) restarts us
  setTimeout(() => process.exit(1), 500);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[ERROR] unhandledRejection at ${new Date().toISOString()}:`, reason);
  // Don't exit — unhandled rejections are often non-fatal (e.g. network timeouts)
  // but we want them visible in logs
});
const { startCleanupJob } = require("./jobs/cleanupTokens");
const { startSweepJob }   = require("./jobs/sweepExpiredSubscriptions");
const express    = require("express");
const cors        = require("cors");
const compression = require("compression");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");
const morgan     = require("morgan");
const path       = require("path");
const db         = require("./config/db");

// ── Abort early if required secrets are missing ───────────────────
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("FATAL: JWT_SECRET missing or too short (min 32 chars)");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("FATAL: DATABASE_URL not set");
  process.exit(1);
}

// ── Payment key checks (warn, don't abort) ────────────────────────
const paystackKey = process.env.PAYSTACK_SECRET_KEY || "";
if (!paystackKey) {
  console.warn("WARN: PAYSTACK_SECRET_KEY is not set — Paystack checkout will fail.");
} else if (paystackKey.startsWith("sk_test_")) {
  console.warn("WARN: PAYSTACK_SECRET_KEY is a TEST key (sk_test_...). Use sk_live_... in production.");
} else if (paystackKey.startsWith("sk_live_")) {
  console.log("[Paystack] Live key detected ✓");
}


const app = express();

// ── Trust proxy (Railway) ─────────────────────────────────────────
app.set("trust proxy", 1);

// ── Gzip compression ─────────────────────────────────────────────
app.use(compression());

// ── Security headers ─────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com"],
      imgSrc:      ["'self'", "data:", "https:"],
      connectSrc:  ["'self'", "https:"],
      objectSrc:   ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// ── CORS ─────────────────────────────────────────────────────────
// ALLOWED_ORIGINS env var: comma-separated list of allowed origins.
// Set this in Railway to your Vercel domain (and custom domain if any).
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "http://localhost:3000,http://localhost:5500"
)
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

console.log("CORS allowed origins:", allowedOrigins);

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin requests (Postman, curl, health checks have no Origin)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    console.warn("CORS blocked:", origin);
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Authorization"],
  maxAge: 600,
}));

// ── Rate limiting ─────────────────────────────────────────────────
// Strict limit on login to slow brute-force
app.use("/api/auth/login", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many login attempts. Try again in 15 minutes." },
}));

// General API limit
app.use("/api/", rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Slow down." },
}));

// ── Paystack webhook needs raw body BEFORE express.json ──────────
app.use("/api/subscriptions/paystack/webhook", express.raw({ type: "application/json" }));

// ── Body parsing (with size limits) ──────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// ── HTTP logging (skip in test) ───────────────────────────────────
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("combined"));
}

// ── Global HTML sanitization on all request bodies ────────────────
const { sanitizeBody } = require("./middleware/sanitize");
app.use(sanitizeBody);

// ── Serve frontend static files ──────────────────────────────────
app.use(express.static(path.join(__dirname, "../frontend"), {
  maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
  etag: true,
}));

// ── API routes ────────────────────────────────────────────────────
app.use("/api/auth",        require("./routes/auth"));
app.use("/api/schools",     require("./routes/schools"));   // auth applied per-route (learning-areas is public-ish)
app.use("/api/subscriptions", require("./routes/subscriptions")); // auth applied per-route (IPN + webhook are public)

// ── Enforce must_change_password — block all routes except change-password ──
function requirePasswordChange(req, res, next) {
  if (req.user?.must_change_password)
    return res.status(403).json({
      success: false,
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "You must change your password before continuing.",
    });
  next();
}

const requireSubscription = require("./middleware/subscriptionMiddleware");
const authMiddleware = require("./middleware/authMiddleware");
app.use("/api/users",       authMiddleware, requirePasswordChange, requireSubscription, require("./routes/users"));
app.use("/api/departments", authMiddleware, requirePasswordChange, requireSubscription, require("./routes/departments"));
app.use("/api/teachers",    authMiddleware, requirePasswordChange, requireSubscription, require("./routes/teachers"));
app.use("/api/classes",     authMiddleware, requirePasswordChange, requireSubscription, require("./routes/classes"));
app.use("/api/students",    authMiddleware, requirePasswordChange, requireSubscription, require("./routes/students"));
app.use("/api/assignments", authMiddleware, requirePasswordChange, requireSubscription, require("./routes/assignments"));
app.use("/api/attendance",  authMiddleware, requirePasswordChange, requireSubscription, require("./routes/attendance"));
app.use("/api/assessments", authMiddleware, requirePasswordChange, requireSubscription, require("./routes/assessments"));
app.use("/api/finance",     authMiddleware, requirePasswordChange, requireSubscription, require("./routes/finance"));
app.use("/api/reports",     authMiddleware, requirePasswordChange, requireSubscription, require("./routes/reports"));
app.use("/api/ai",          authMiddleware, requirePasswordChange, requireSubscription, require("./routes/ai"));
app.use("/api/exams",       authMiddleware, requirePasswordChange, requireSubscription, require("./routes/exams"));
app.use("/api/portfolio",   authMiddleware, requirePasswordChange, requireSubscription, require("./routes/portfolio"));
app.use("/api/observations",authMiddleware, requirePasswordChange, requireSubscription, require("./routes/observations"));
app.use("/api/interventions",authMiddleware, requirePasswordChange, requireSubscription, require("./routes/interventions"));
app.use("/api/moderation",  authMiddleware, requirePasswordChange, requireSubscription, require("./routes/moderation"));

// ── Health check (tests DB connectivity) ─────────────────────────
app.get("/api/health", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT NOW() AS ts");
    res.json({ status: "ok", version: "4.2.0", ts: rows[0].ts, db: "ok" });
  } catch (err) {
    console.error("[health] DB check failed:", err.message);
    res.status(503).json({ status: "degraded", version: "4.2.0", ts: new Date().toISOString(), db: "error" });
  }
});

// ── 404 for unmatched API routes ─────────────────────────────────
app.use("/api/*", (req, res) =>
  res.status(404).json({ success: false, message: "Endpoint not found." })
);

// ── SPA fallback ──────────────────────────────────────────────────
app.get("*", (req, res) =>
  res.sendFile(path.join(__dirname, "../frontend/login.html"))
);

// ── Global error handler — NEVER leaks stack traces ──────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // CORS errors
  if (err.message?.startsWith("CORS:"))
    return res.status(403).json({ success: false, message: "Not allowed by CORS." });

  // Log full error internally only
  console.error(`[${new Date().toISOString()}] Unhandled error:`, err.message);

  // Never send err.message or stack to client in production
  if (process.env.NODE_ENV === "production") {
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
  // Development: send a sanitised message (no stack)
  return res.status(500).json({ success: false, message: err.message });
});

startCleanupJob();
startSweepJob();
const PORT = parseInt(process.env.PORT || "5000", 10);
const server = app.listen(PORT, () =>
  console.log(`Kadem & Zetu School Management System v4.2 running on port ${PORT} [${process.env.NODE_ENV || "development"}]`)
);

// ── Request timeout — prevent hung connections blocking the pool ──
// 30s covers even slow AI calls; adjust if needed
server.setTimeout(30000);

// ── Graceful shutdown ─────────────────────────────────────────────
// On SIGTERM (Render deploy/scale), stop accepting new connections
// and wait for in-flight requests to finish (up to 10s), then exit cleanly.
function gracefulShutdown(signal) {
  console.log(`[shutdown] ${signal} received — closing server gracefully…`);
  server.close((err) => {
    if (err) {
      console.error("[shutdown] Error during close:", err.message);
      process.exit(1);
    }
    console.log("[shutdown] All connections closed. Exiting.");
    process.exit(0);
  });
  // Force-kill after 10s if connections don't drain
  setTimeout(() => {
    console.error("[shutdown] Forced exit after 10s timeout.");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

module.exports = app;
