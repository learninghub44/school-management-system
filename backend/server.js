/**
 * CBC School ERP — Hardened Server
 * Security fixes applied: V-01 through V-19
 */
const express     = require("express");
const cors        = require("cors");
const helmet      = require("helmet");
const morgan      = require("morgan");
const rateLimit   = require("express-rate-limit");
const slowDown    = require("express-slow-down");
const cookieParser= require("cookie-parser");
const { sanitizeBody } = require("./middleware/sanitize");
require("dotenv").config();

// ── V-01: Enforce strong JWT_SECRET at startup ────────────────────
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 64) {
    console.error("❌ FATAL: JWT_SECRET must be at least 64 characters.");
    console.error("   Generate: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"");
    process.exit(1);
}

const app = express();

// ── V-17: Security headers via helmet ────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc:  ["'self'"],
            scriptSrc:   ["'self'"],
            styleSrc:    ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
            fontSrc:     ["'self'", "https://fonts.gstatic.com"],
            imgSrc:      ["'self'", "data:", "https:"],
            connectSrc:  ["'self'"],
            frameSrc:    ["'none'"],
            objectSrc:   ["'none'"],
            upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null,
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));

// ── V-10: Strict CORS — explicit origins only ─────────────────────
// Support comma-separated list or single origin
let allowedOrigins = (process.env.CORS_ORIGIN || "")
    .split(",").map(s => s.trim()).filter(Boolean);

// V-10: Fallback for Cloudflare Pages (from your screenshot)
if (process.env.NODE_ENV === "production" && !allowedOrigins.includes("https://cbc-school-erp.pages.dev")) {
    allowedOrigins.push("https://cbc-school-erp.pages.dev");
}

if (!allowedOrigins.length) {
    console.warn("⚠️  CORS_ORIGIN not set — all origins blocked in production.");
}

app.use(cors({
    origin: (origin, cb) => {
        // Allow non-browser requests (Render health checks, curl, Postman)
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS: Origin ${origin} not allowed.`));
    },
    credentials: true,
    methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
    allowedHeaders: ["Content-Type","Authorization"],
}));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(cookieParser());

// ── Structured request logging ─────────────────────────────────────
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ── V-09: Sanitize all request body input ─────────────────────────
app.use(sanitizeBody);

// ── V-02: General rate limit ──────────────────────────────────────
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many requests. Slow down." },
}));

// ── V-02 + V-18: Progressive slow-down on login attempts ──────────
app.use("/api/auth/login", slowDown({
    windowMs: 15 * 60 * 1000,
    delayAfter: 3,              // start slowing after 3 attempts
    delayMs: (hits) => Math.min(hits * 500, 10000), // ramp up to 10s delay
}));

// ── V-02: Hard rate limit on login ────────────────────────────────
app.use("/api/auth/login", rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,                    // max 10 attempts per 15 min per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Too many login attempts. Try again in 15 minutes." },
}));

// ── Tighter limit on password change ──────────────────────────────
app.use("/api/auth/change-password", rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { success: false, message: "Too many password change attempts." },
}));

// ── V-02: Strict rate limit on data writes (prevent DB flooding) ──
const writeLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30,                 // 30 writes per minute per IP
    message: { success: false, message: "Too many data modifications. Please wait a moment." },
});
app.post("/api/*",   writeLimiter);
app.put("/api/*",    writeLimiter);
app.patch("/api/*",  writeLimiter);
app.delete("/api/*", writeLimiter);

// ─── Routes ────────────────────────────────────────────────────────
app.use("/api/auth",        require("./routes/auth"));
app.use("/api/schools",     require("./routes/schools"));
app.use("/api/users",       require("./routes/users"));
app.use("/api/students",    require("./routes/students"));
app.use("/api/teachers",    require("./routes/teachers"));
app.use("/api/finance",     require("./routes/finance"));
app.use("/api/attendance",  require("./routes/attendance"));
app.use("/api/assessments", require("./routes/assessments"));
app.use("/api/cbc",         require("./routes/cbc"));

app.get("/", (req, res) => res.json({ name: "ZETU School Management System API", version: "3.0.0", status: "running" }));
app.get("/api/health", (req, res) => res.json({ success: true, timestamp: new Date().toISOString() }));

// ─── 404 ───────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ success: false, message: "Not found." }));

// ─── V-11: Global error handler — no stack traces in production ───
app.use((err, req, res, next) => {
    if (err.message?.startsWith("CORS:")) {
        return res.status(403).json({ success: false, message: "Forbidden." });
    }
    // Log full error server-side only
    console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
    return res.status(500).json({ success: false, message: "An unexpected error occurred." });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅  ZETU School Management System API on port ${PORT}`));
