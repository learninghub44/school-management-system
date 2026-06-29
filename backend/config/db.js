"use strict";

/**
 * DB connection — Neon HTTP for Workers, pg Pool for Node.js.
 *
 * Workers detection: nodejs_compat does NOT define WebSocketPair.
 * Use navigator.userAgent or the WORKER_RUNTIME env flag instead.
 * Safest: set a [vars] flag in wrangler.toml → WORKER_RUNTIME=true.
 */

const isWorker = globalThis.WORKER_RUNTIME === true ||
                 process.env.WORKER_RUNTIME === "true";

let query, pool;

if (isWorker) {
  // ── Cloudflare Workers: @neondatabase/serverless HTTP mode ────────
  // HTTP mode (neon tagged template) works without WebSockets.
  // For Workers, use neon() for single queries — no persistent pool needed.
  const { neon, neonConfig } = require("@neondatabase/serverless");

  neonConfig.fetchConnectionCache = true;

  const sql = neon(process.env.DATABASE_URL);

  // Wrap to match pg's { rows } interface
  query = async (text, params) => {
    const rows = await sql(text, params || []);
    return { rows, rowCount: rows.length };
  };

  pool = { query };

  console.log("[db] Using @neondatabase/serverless HTTP mode (Workers)");

} else {
  // ── Node.js / local dev: standard pg Pool ────────────────────────
  const { Pool } = require("pg");

  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("neon.tech") || process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
    min: parseInt(process.env.DB_POOL_MIN || "2", 10),
    max: parseInt(process.env.DB_POOL_MAX || "10", 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
    statement_timeout: 20000,
    query_timeout:     20000,
  });

  pgPool.on("error", (err) => console.error("[db] Pool error:", err.message));
  pgPool.on("connect", () => {
    if (process.env.NODE_ENV !== "production") console.log("[db] New client connected");
  });

  async function warmUp(retries = 5, delayMs = 3000) {
    for (let i = 1; i <= retries; i++) {
      try { await pgPool.query("SELECT 1"); console.log("[db] Pool ready"); return; }
      catch (err) {
        console.error(`[db] Attempt ${i}/${retries}: ${err.message}`);
        if (i < retries) await new Promise(r => setTimeout(r, delayMs));
      }
    }
    console.error("[db] All warmup attempts failed");
  }

  warmUp();
  pool  = pgPool;
  query = (text, params) => pgPool.query(text, params);
}

module.exports = { query, pool };
