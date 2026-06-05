/**
 * CBC School ERP — Express Server v4.0
 */
require("dotenv").config();
const express     = require("express");
const cors        = require("cors");
const helmet      = require("helmet");
const rateLimit   = require("express-rate-limit");
const morgan      = require("morgan");
const path        = require("path");

const app = express();
app.set("trust proxy", 1);
// ── Security headers ──────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'","'unsafe-inline'","https://fonts.googleapis.com"],
      styleSrc:   ["'self'","'unsafe-inline'","https://fonts.googleapis.com","https://fonts.gstatic.com"],
      fontSrc:    ["'self'","https://fonts.gstatic.com"],
      imgSrc:     ["'self'","data:","https:"],
      connectSrc: ["'self'"],
    }
  },
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ──────────────────────────────────────────────────────────
const allowedOrigins = (
  process.env.CORS_ORIGIN ||
  "http://localhost:3000,http://localhost:5500,https://cbc-school-erp.pages.dev"
)
  .split(",")
  .map(origin => origin.trim());

console.log("Allowed Origins:", allowedOrigins);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));

// ── Rate limiting ─────────────────────────────────────────────────
app.use("/api/auth/login", rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { success: false, message: "Too many login attempts. Try again in 15 minutes." },
  standardHeaders: true, legacyHeaders: false,
}));
app.use("/api/", rateLimit({
  windowMs: 1 * 60 * 1000, max: 300,
  message: { success: false, message: "Rate limit exceeded." },
  standardHeaders: true, legacyHeaders: false,
}));

// ── Body parsing ──────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));

// ── Logging ───────────────────────────────────────────────────────
if (process.env.NODE_ENV !== "test") app.use(morgan("combined"));

// ── Serve frontend ────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "../frontend"), {
  maxAge: process.env.NODE_ENV === "production" ? "1d" : 0,
}));

// ── API routes ────────────────────────────────────────────────────
app.use("/api/auth",        require("./routes/auth"));
app.use("/api/schools",     require("./routes/schools"));
app.use("/api/users",       require("./routes/users"));
app.use("/api/departments", require("./routes/departments"));
app.use("/api/teachers",    require("./routes/teachers"));
app.use("/api/classes",     require("./routes/classes"));
app.use("/api/students",    require("./routes/students"));
app.use("/api/assignments", require("./routes/assignments"));
app.use("/api/attendance",  require("./routes/attendance"));
app.use("/api/assessments", require("./routes/assessments"));
app.use("/api/finance",     require("./routes/finance"));
app.use("/api/reports",     require("./routes/reports"));

// ── Health check ──────────────────────────────────────────────────
app.get("/api/health", (req, res) => res.json({
  status: "ok", version: "4.0.0", timestamp: new Date().toISOString()
}));

// ── SPA fallback ──────────────────────────────────────────────────
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ success: false, message: "Endpoint not found." });
  res.sendFile(path.join(__dirname, "../frontend/login.html"));
});

// ── Global error handler ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("🔥 FULL ERROR:", err);

  res.status(500).json({
    success: false,
    message: err.message,
    stack: err.stack
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 CBC School ERP v4.0 running on port ${PORT}`));

module.exports = app;
