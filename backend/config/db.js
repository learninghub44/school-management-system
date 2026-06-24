/**
 * PostgreSQL connection pool
 * SSL forced in production; disabled for local dev
 */
"use strict";
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
  min: 2,                          // keep 2 connections warm — avoids cold-start latency spike
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,   // fail fast if pool is exhausted
  statement_timeout: 15000,        // kill runaway queries after 15s
  query_timeout:    15000,         // covers both idle + running
});

pool.on("error", (err) => {
  // Log but don't crash — the pool will reconnect automatically
  console.error("[db] Unexpected pool error:", err.message);
});

pool.on("connect", () => {
  if (process.env.NODE_ENV !== "production") console.log("[db] New client connected");
});

// Warm-up: verify connection on startup
pool.query("SELECT 1").then(() => {
  console.log("[db] Connection pool ready");
}).catch(err => {
  console.error("[db] Connection failed on startup:", err.message);
  // Don't exit — Render may start the DB after the web service
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
