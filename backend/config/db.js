"use strict";

const isWorker = globalThis.WORKER_RUNTIME === true ||
                 process.env.WORKER_RUNTIME === "true";

let query, pool;

if (isWorker) {
  // Lazy-init — DATABASE_URL isn't available at module load time in Workers.
  // It's injected per-request by worker-entry.js injectEnv().
  const { neon, neonConfig } = require("@neondatabase/serverless");
  neonConfig.fetchConnectionCache = true;

  let _sql = null;
  const getSql = () => {
    if (!_sql) {
      if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
      _sql = neon(process.env.DATABASE_URL);
    }
    return _sql;
  };

  query = async (text, params) => {
    const rows = await getSql()(text, params || []);
    return { rows, rowCount: rows.length };
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
