/**
 * ZETU School Management System — Frontend Configuration
 * Pure browser-safe JavaScript. No process.env (Node.js only).
 * Set window.API_BASE_URL before this script to override the API URL.
 * On Cloudflare Pages / Netlify: inject via _headers or a deploy script.
 */

(function () {
  const hostname = window.location.hostname;
  const isLocal  = hostname === "localhost" || hostname === "127.0.0.1";

  // ── API URL resolution (priority order) ───────────────────────────
  // 1. Hard-injected at deploy time:  window.API_BASE_URL = "https://..."
  // 2. Local dev fallback
  // 3. Production fallback (update this to your actual Render URL)
  const API_BASE_URL =
    window.API_BASE_URL ||
    (isLocal
      ? "http://localhost:5000/api"
      : "https://cbc-school-erp-api.onrender.com/api");

  window.CONFIG = {
    API: {
      BASE_URL: API_BASE_URL,
    },
    AUTH: {
      TOKEN_KEY: "zetu_auth_token",
      USER_KEY:  "zetu_user",
    },
    APP: {
      NAME:        "ZETU School Management System",
      VERSION:     "1.0.0",
      ENVIRONMENT: isLocal ? "development" : "production",
    },
  };

  if (isLocal) {
    console.log("✅ ZETU Config loaded:", window.CONFIG.API.BASE_URL);
  }
})();
