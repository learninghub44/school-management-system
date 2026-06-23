/**
 * CBC School ERP — Express Server v4.1
 * Production-hardened: Helmet, CORS whitelist, rate limiting,
 * global error handler that never leaks stack traces
 */
"use strict";
require("dotenv").config();
const { startCleanupJob } = require("./jobs/cleanupTokens");
const express    = require("express");
const cors       = require("cors");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");
const morgan     = require("morgan");
const path       = require("path");

// ── Abort early if required secrets are missing ───────────────────
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("FATAL: JWT_SECRET missing or too short (min 32 chars)");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("FATAL: DATABASE_URL not set");
  process.exit(1);
}

const app = express();

// ── Trust proxy (for Render / Cloudflare) ────────────────────────
app.set("trust proxy", 1);

// ── Security headers ─────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com"],
      imgSrc:      ["'self'", "data:", "https:"],
      connectSrc:  ["'self'"],
      objectSrc:   ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// ── CORS ─────────────────────────────────────────────────────────
// ALLOWED_ORIGINS env var: comma-separated list of allowed origins.
// Always includes the Cloudflare Pages production domain by default.
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "http://localhost:3000,http://localhost:5500,https://cbc-school-erp.pages.dev"
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

// ── Serve frontend static files ──────────────────────────────────
app.use(express.static(path.join(__dirname, "../frontend"), {
  maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
  etag: true,
}));

// ── API routes ────────────────────────────────────────────────────
app.use("/api/auth",        require("./routes/auth"));
app.use("/api/schools",     require("./routes/schools"));
app.use("/api/subscriptions", require("./routes/subscriptions"));

const requireSubscription = require("./middleware/subscriptionMiddleware");
const authMiddleware = require("./middleware/authMiddleware");
app.use("/api/users",       authMiddleware, requireSubscription, require("./routes/users"));
app.use("/api/departments", authMiddleware, requireSubscription, require("./routes/departments"));
app.use("/api/teachers",    authMiddleware, requireSubscription, require("./routes/teachers"));
app.use("/api/classes",     authMiddleware, requireSubscription, require("./routes/classes"));
app.use("/api/students",    authMiddleware, requireSubscription, require("./routes/students"));
app.use("/api/assignments", authMiddleware, requireSubscription, require("./routes/assignments"));
app.use("/api/attendance",  authMiddleware, requireSubscription, require("./routes/attendance"));
app.use("/api/assessments", authMiddleware, requireSubscription, require("./routes/assessments"));
app.use("/api/finance",     authMiddleware, requireSubscription, require("./routes/finance"));
app.use("/api/reports",     authMiddleware, requireSubscription, require("./routes/reports"));
app.use("/api/ai",          require("./routes/ai"));

// ── Health check ─────────────────────────────────────────────────
app.get("/api/health", (req, res) =>
  res.json({ status: "ok", version: "4.1.0", ts: new Date().toISOString() })
);

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
const PORT = parseInt(process.env.PORT || "5000", 10);
app.listen(PORT, () =>
  console.log(`CBC School ERP v4.1 running on port ${PORT} [${process.env.NODE_ENV || "development"}]`)
);

module.exports = app;
