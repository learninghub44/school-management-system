/**
 * PostgreSQL connection — Neon-compatible
 *
 * Neon serverless Postgres requires SSL and works best with their
 * HTTP-based driver in Workers. We use @neondatabase/serverless which
 * speaks the Postgres wire protocol over WebSockets (Workers-compatible)
 * AND falls back to the standard pg Pool for local Node.js dev.
 *
 * Connection string format (set as DATABASE_URL secret):
 *   postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require
 *
 * For Workers: use the POOLED endpoint (port 5432, hostname ending in -pooler.* or standard).
 * Neon provides a connection pooler (PgBouncer) — use that URL for Workers.
 */
"use strict";

const isWorker = typeof WebSocketPair !== "undefined" ||
                 (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers");

let query, pool;

if (isWorker) {
  // ── Cloudflare Workers: use @neondatabase/serverless ─────────────
  // This uses WebSockets under the hood — compatible with Workers runtime.
  const { Pool: NeonPool, neonConfig } = require("@neondatabase/serverless");
  const { WebSocket } = require("ws"); // bundled via nodejs_compat

  // Workers need to use the global WebSocket
  neonConfig.webSocketConstructor = globalThis.WebSocket || WebSocket;
  neonConfig.useSecureWebSocket = true;
  neonConfig.pipelineConnect = false;

  const neonPool = new NeonPool({
    connectionString: process.env.DATABASE_URL,
    max: 5, // Keep low — Workers are short-lived
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
  });

  pool  = neonPool;
  query = (text, params) => neonPool.query(text, params);

  neonPool.on("error", (err) => {
    console.error("[db/neon] Pool error:", err.message);
  });

  console.log("[db] Using @neondatabase/serverless (Workers mode)");

} else {
  // ── Node.js / local dev: standard pg Pool ─────────────────────────
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

  pgPool.on("error", (err) => {
    console.error("[db] Unexpected pool error:", err.message);
  });

  pgPool.on("connect", () => {
    if (process.env.NODE_ENV !== "production") console.log("[db] New client connected");
  });

  // Warm-up with retry — useful on Render/Railway cold starts
  async function warmUp(retries = 5, delayMs = 3000) {
    for (let i = 1; i <= retries; i++) {
      try {
        await pgPool.query("SELECT 1");
        console.log("[db] Connection pool ready");
        return;
      } catch (err) {
        console.error(`[db] Attempt ${i}/${retries} failed: ${err.message}`);
        if (i < retries) await new Promise(r => setTimeout(r, delayMs));
      }
    }
    console.error("[db] All attempts failed — will retry on first request");
  }

  warmUp();

  pool  = pgPool;
  query = (text, params) => pgPool.query(text, params);
}

module.exports = { query, pool };
