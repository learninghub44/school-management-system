"use strict";
const db = require("../config/db");

async function cleanupExpiredTokens() {
  try {
    const { rowCount } = await db.query(
      "DELETE FROM token_blocklist WHERE expires_at < NOW()"
    );
    if (rowCount > 0) console.log(`[cleanup] Removed ${rowCount} expired token(s)`);
  } catch (err) {
    console.error("[cleanup] Token cleanup failed:", err.message);
  }
}

function startCleanupJob() {
  cleanupExpiredTokens();
  setInterval(cleanupExpiredTokens, 60 * 60 * 1000);
}

module.exports = { startCleanupJob };
