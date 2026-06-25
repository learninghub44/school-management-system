/**
 * PostgreSQL connection pool
 * SSL forced in production; disabled for local dev
 * Pool size configurable via DB_POOL_MIN / DB_POOL_MAX env vars
 */
"use strict";
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
  min: parseInt(process.env.DB_POOL_MIN || "2", 10),
  max: parseInt(process.env.DB_POOL_MAX || "20", 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
  statement_timeout: 20000,
  query_timeout:    20000,
});

pool.on("error", (err) => {
  console.error("[db] Unexpected pool error:", err.message);
});

pool.on("connect", () => {
  if (process.env.NODE_ENV !== "production") console.log("[db] New client connected");
});

// Warm-up with retry — Render sometimes starts DB after web service
async function warmUp(retries = 5, delayMs = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query("SELECT 1");
      console.log("[db] Connection pool ready");
      return;
    } catch (err) {
      console.error(`[db] Connection attempt ${i}/${retries} failed: ${err.message}`);
      if (i < retries) await new Promise(r => setTimeout(r, delayMs));
    }
  }
  console.error("[db] All connection attempts failed — server will retry on first request");
}

warmUp();

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
