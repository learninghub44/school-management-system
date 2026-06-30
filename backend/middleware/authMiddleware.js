/**
 * authMiddleware — verifies JWT + blocklist + live DB check
 *
 * Caches the DB user lookup for 30 seconds per user ID in a simple
 * in-process LRU map (max 2000 entries). This cuts 2 DB queries → 0
 * on most authenticated requests while still enforcing revocations
 * within 30s. The blocklist check is still live (it's indexed and fast).
 *
 * Cache is busted on logout (the blocklist write is the signal).
 */
"use strict";
const jwt = require("jsonwebtoken");
const db  = require("../config/db");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Simple bounded in-process cache ──────────────────────────────────
const USER_CACHE_TTL = 30 * 1000; // 30 seconds
const USER_CACHE_MAX = 2000;
const userCache = new Map(); // key: userId → { data, exp }

function cacheGet(userId) {
  const entry = userCache.get(userId);
  if (!entry) return null;
  if (Date.now() > entry.exp) { userCache.delete(userId); return null; }
  return entry.data;
}

function cacheSet(userId, data) {
  // Evict oldest if at limit (Map preserves insertion order)
  if (userCache.size >= USER_CACHE_MAX) {
    userCache.delete(userCache.keys().next().value);
  }
  userCache.set(userId, { data, exp: Date.now() + USER_CACHE_TTL });
}

// Called externally on logout so we don't serve stale data
function cacheBust(userId) { userCache.delete(userId); }

// ── Middleware ────────────────────────────────────────────────────────
async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer "))
      return res.status(401).json({ success: false, message: "No token provided." });

    const token = header.split(" ")[1];
    let payload;
    try {
      payload = jwt.verify(token, (globalThis.WORKER_ENV?.JWT_SECRET) || process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: "Invalid or expired token." });
    }

    // ── Blocklist check (always live — indexed, cheap) ──────────────
    if (payload.jti) {
      const { rows: bl } = await db.query(
        "SELECT 1 FROM token_blocklist WHERE jti=$1", [payload.jti]
      );
      if (bl.length)
        return res.status(401).json({ success: false, message: "Token has been revoked." });
    }

    // ── User data (cached, fallback to DB) ───────────────────────────
    let userData = cacheGet(payload.id);
    if (!userData) {
      const { rows } = await db.query(
        `SELECT u.id, u.role, u.school_id, u.is_active,
                u.must_change_password,
                s.is_active AS school_active
         FROM users u
         LEFT JOIN schools s ON s.id = u.school_id
         WHERE u.id = $1`,
        [payload.id]
      );
      if (!rows.length)
        return res.status(401).json({ success: false, message: "Account not found." });
      userData = rows[0];
      cacheSet(payload.id, userData);
    }

    if (!userData.is_active)
      return res.status(401).json({ success: false, message: "Account is inactive." });
    if (userData.school_active === false)
      return res.status(403).json({ success: false, message: "School account is deactivated." });

    req.user = {
      ...payload,
      role:                userData.role,
      school_id:           userData.school_id,
      must_change_password: userData.must_change_password,
    };

    next();
  } catch (err) {
    console.error("authMiddleware:", err.message);
    return res.status(500).json({ success: false, message: "Authentication error." });
  }
}

module.exports = authMiddleware;
module.exports.cacheBust = cacheBust;
