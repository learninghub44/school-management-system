"use strict";

const isWorker = globalThis.WORKER_RUNTIME === true ||
                 process.env.WORKER_RUNTIME === "true";

let query, pool;

if (isWorker) {
  // Lazy-init — DATABASE_URL isn't available at module load time in Workers.
  // It's injected per-request by worker-entry.js injectEnv().
  const { neon } = require("@neondatabase/serverless");
  // NOTE: fetchConnectionCache is intentionally left at its default (no longer
  // forced to `true`). Forcing it on caches a connection at module/isolate
  // scope — if the DB password is ever rotated (as happened earlier this
  // project), a Worker isolate that's still warm can keep retrying a now-dead
  // cached connection. That failure happens at the transport layer, below our
  // try/catch, so it doesn't return our JSON error response — it surfaces as
  // a raw platform 503 from Cloudflare's edge instead of a normal API error.

  let _sql = null;
  let _sqlUrl = null;
  const getSql = () => {
    // Re-create the client if DATABASE_URL changed (e.g. secret rotated and
    // a new isolate picked it up) — cheap check, avoids reusing a dead client.
    if (!_sql || _sqlUrl !== process.env.DATABASE_URL) {
      if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
      _sql = neon(process.env.DATABASE_URL);
      _sqlUrl = process.env.DATABASE_URL;
    }
    return _sql;
  };

  // Errors that indicate a broken/stale connection rather than a bad query —
  // worth one fresh retry before giving up.
  function isTransientConnError(err) {
    const msg = String(err?.message || "").toLowerCase();
    return (
      msg.includes("fetch failed") ||
      msg.includes("network") ||
      msg.includes("econnreset") ||
      msg.includes("socket") ||
      msg.includes("timeout") ||
      msg.includes("connection") ||
      err?.code === "ECONNRESET"
    );
  }

  query = async (text, params) => {
    try {
      const rows = await getSql()(text, params || []);
      return { rows, rowCount: rows.length };
    } catch (err) {
      if (isTransientConnError(err)) {
        console.warn("[db] Transient connection error, retrying once:", err.message);
        _sql = null; // force a fresh client on retry
        try {
          const rows = await getSql()(text, params || []);
          return { rows, rowCount: rows.length };
        } catch (retryErr) {
          retryErr.isDbConnectionError = true;
          throw retryErr;
        }
      }
      throw err;
    }
  };
  pool = { query };

} else {
  const { Pool } = require("pg");

  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("neon.tech") || process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false } : false,
    min: parseInt(process.env.DB_POOL_MIN || "2", 10),
    max: parseInt(process.env.DB_POOL_MAX || "10", 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
    statement_timeout: 20000,
    query_timeout: 20000,
  });

  pgPool.on("error", (err) => console.error("[db] Pool error:", err.message));

  async function warmUp(retries = 5, delayMs = 3000) {
    for (let i = 1; i <= retries; i++) {
      try { await pgPool.query("SELECT 1"); console.log("[db] Pool ready"); return; }
      catch (err) {
        console.error(`[db] Attempt ${i}/${retries}: ${err.message}`);
        if (i < retries) await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  warmUp();
  pool  = pgPool;
  query = (text, params) => pgPool.query(text, params);
}

module.exports = { query, pool };
