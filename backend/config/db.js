"use strict";

const isWorker = globalThis.WORKER_RUNTIME === true ||
                 process.env.WORKER_RUNTIME === "true";

let query, pool;

if (isWorker) {
  // Lazy-init — DATABASE_URL isn't available at module load time in Workers.
  // It's injected per-request by worker-entry.js injectEnv().
  //
  // Cloudflare Workers can't hold a raw TCP connection open the way a normal
  // Node process can, so the DB client here is picked per DATABASE_URL:
  //
  //  - Neon URL (*.neon.tech)  → @neondatabase/serverless. Talks to Neon's
  //    own HTTP/WebSocket proxy, so it "just works" in Workers with no
  //    connection pooler needed. Fastest, most battle-tested path.
  //
  //  - Any other Postgres (Railway, Render, self-hosted, Supabase, etc.) →
  //    standard `pg`, using Workers' `nodejs_compat` net/tls shims (already
  //    enabled in wrangler.toml) to open a real TCP socket. This works, but
  //    each Worker invocation opens its own connection to the database —
  //    fine for low/medium traffic, but for production load you should put
  //    a connection pooler in front of it. Two easy options:
  //      1. Cloudflare Hyperdrive (https://developers.cloudflare.com/hyperdrive/)
  //         — point Hyperdrive at your Postgres, use its connection string
  //         as DATABASE_URL, and it pools/caches connections at Cloudflare's
  //         edge for you. No code changes needed here.
  //      2. Your Postgres provider's own pooler (Supabase's pooled
  //         connection string on port 6543, Neon's pooled string, PgBouncer
  //         in front of a self-hosted DB, etc.) — just use that URL.
  //
  // If you're not on Cloudflare Workers at all (Docker/Railway/Render/VPS —
  // the `else` branch below), none of this applies: it's a normal `pg` Pool
  // against any Postgres, no restrictions.
  const isNeonUrl = (url) => /\.neon\.tech/i.test(url || "");

  let _client = null;   // { kind: "neon", sql } | { kind: "pg", pool }
  let _clientUrl = null;

  const getClient = () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL not set");
    // Re-create the client if DATABASE_URL changed (e.g. secret rotated and
    // a new isolate picked it up) — cheap check, avoids reusing a dead client.
    if (!_client || _clientUrl !== url) {
      if (isNeonUrl(url)) {
        const { neon } = require("@neondatabase/serverless");
        _client = { kind: "neon", sql: neon(url) };
      } else {
        const { Pool } = require("pg");
        _client = {
          kind: "pg",
          pool: new Pool({
            connectionString: url,
            ssl: { rejectUnauthorized: false },
            max: 1, // one Worker invocation = one request-scoped connection
            connectionTimeoutMillis: 8000,
            statement_timeout: 20000,
            query_timeout: 20000,
          }),
        };
      }
      _clientUrl = url;
    }
    return _client;
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

  const runQuery = async (text, params) => {
    const client = getClient();
    if (client.kind === "neon") {
      const rows = await client.sql(text, params || []);
      return { rows, rowCount: rows.length };
    }
    return client.pool.query(text, params);
  };

  query = async (text, params) => {
    try {
      return await runQuery(text, params);
    } catch (err) {
      if (isTransientConnError(err)) {
        console.warn("[db] Transient connection error, retrying once:", err.message);
        _client = null; // force a fresh client on retry
        try {
          return await runQuery(text, params);
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
