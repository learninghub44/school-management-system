/**
 * CBC School ERP — Frontend Configuration
 * Loaded as a plain <script> BEFORE any ES module.
 * Sets window.API_BASE so api.js picks it up immediately.
 */
(function () {
  const hostname = window.location.hostname;
  const isLocal  = hostname === "localhost" || hostname === "127.0.0.1";

  // ── API base URL ────────────────────────────────────────────────
  // Priority: 1) injected at deploy  2) local dev  3) production Render URL
  window.API_BASE =
    window.API_BASE_URL ||
    (isLocal
      ? "http://localhost:3000/api"
      : "https://cbc-school-erp-api.onrender.com/api");

  // ── Storage keys (single source of truth) ───────────────────────
  window.STORAGE_KEYS = {
    TOKEN: "cbc_token",
    USER:  "cbc_user",
  };

  // ── Legacy compat (keep window.CONFIG for anything that references it) ──
  window.CONFIG = {
    API: { BASE_URL: window.API_BASE },
    AUTH: { TOKEN_KEY: window.STORAGE_KEYS.TOKEN, USER_KEY: window.STORAGE_KEYS.USER },
    APP:  { NAME: "CBC School ERP", VERSION: "4.0.0", ENVIRONMENT: isLocal ? "development" : "production" },
  };

  if (isLocal) console.log("✅ CBC ERP config:", window.API_BASE);
})();
