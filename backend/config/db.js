/**
 * PostgreSQL connection pool
 * SSL forced in production; disabled for local dev
 */
"use strict";
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }  // Render/Supabase self-signed certs
    : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,   // kill runaway queries after 10s
});

pool.on("error", (err) => {
  console.error("Unexpected DB pool error:", err.message);
});

// Warm-up: verify connection on startup
pool.query("SELECT 1").catch(err =>
  console.error("DB connection failed:", err.message)
);

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,  // exposed for transaction support if needed
};
