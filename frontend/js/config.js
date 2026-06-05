/**
 * CBC School ERP — Frontend Configuration v4.2
 *
 * HOW THE API URL IS RESOLVED (in priority order):
 *
 * 1. window.API_BASE_URL   — injected by Cloudflare Pages env var at build time
 *                            Set: Settings → Environment Variables → API_BASE_URL
 *                            Value: https://YOUR-SERVICE.onrender.com/api
 *
 * 2. Same-origin /api      — works when frontend & backend are on the same domain
 *                            (e.g. Render static site serving both)
 *
 * 3. localhost:3000/api    — local development fallback
 *
 * TO FIX "Network error" on cbc-school-erp.pages.dev:
 *   Go to Cloudflare Pages → Settings → Environment Variables
 *   Add: API_BASE_URL = https://YOUR-RENDER-URL.onrender.com/api
 */
(function () {
  const hostname = window.location.hostname;
  const isLocal  = hostname === "localhost" || hostname === "127.0.0.1";

  // Option 1: Explicitly injected at build/deploy time (recommended)
  // Cloudflare Pages: add API_BASE_URL as an env var in your Pages project settings
  // The value gets embedded by Cloudflare at build time if you reference it
  // as window.API_BASE_URL = "{{API_BASE_URL}}" in a _worker.js or via Pages Functions.
  // For simplicity we support it being set directly before this script loads.
  if (window.API_BASE_URL) {
    window.API_BASE = window.API_BASE_URL;
  }
  // Option 2: Local dev
  else if (isLocal) {
    window.API_BASE = "http://localhost:3000/api";
  }
  // Option 3: Same-origin (when served from same domain as backend)
  else {
    window.API_BASE = window.location.origin + "/api";
  }

  // Storage keys
  window.STORAGE_KEYS = {
    TOKEN: "cbc_token",
    USER:  "cbc_user",
  };

  window.CONFIG = {
    API: { BASE_URL: window.API_BASE },
    AUTH: { TOKEN_KEY: window.STORAGE_KEYS.TOKEN, USER_KEY: window.STORAGE_KEYS.USER },
    APP:  { NAME: "CBC School ERP", VERSION: "4.2.0", ENVIRONMENT: isLocal ? "development" : "production" },
  };

  if (isLocal || window.location.search.includes("debug=1")) {
    console.log("CBC ERP config:", { API_BASE: window.API_BASE, env: window.CONFIG.APP.ENVIRONMENT });
  }
})();
