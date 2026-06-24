/**
 * Kadem & Zetu School Management System — Frontend Configuration v5.3
 *
 * SIMPLIFIED APPROACH:
 * - SUPER_ADMIN always uses key "cbc_token_SUPER_ADMIN" regardless of URL
 * - School staff always use "cbc_token_SCHOOL" (single shared key per browser)
 * - No subdomain requirement — works on plain pages.dev
 *
 * Login URL:
 *   All staff use /login.html
 */
(function () {
  const hostname = window.location.hostname;
  const isLocal  = hostname === "localhost" || hostname === "127.0.0.1";

  // ── API base ──────────────────────────────────────────────────────
  window.API_BASE = isLocal
    ? "http://localhost:5000/api"
    : window.location.origin + "/api";

  // ── Storage keys — simple, not tenant-scoped ──────────────────────
  // SUPER_ADMIN and school staff stored separately so they never clash
  window.STORAGE_KEYS = {
    TOKEN: "cbc_erp_token",
    USER:  "cbc_erp_user",
  };

  // ── Tenant — always detect from stored user, not from URL ─────────
  // We set TENANT after reading who is currently logged in
  function getStoredUser() {
    try { return JSON.parse(localStorage.getItem("cbc_erp_user") || "null"); }
    catch { return null; }
  }

  const storedUser = getStoredUser();

  window.TENANT = {
    schoolCode:   storedUser?.school_code || null,
    isSuperAdmin: storedUser?.role === "SUPER_ADMIN",
    isGuest:      !storedUser,
    raw:          storedUser?.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : (storedUser?.school_code || "GUEST"),
  };

  window.CONFIG = {
    API:    { BASE_URL: window.API_BASE },
    AUTH:   { TOKEN_KEY: window.STORAGE_KEYS.TOKEN, USER_KEY: window.STORAGE_KEYS.USER },
    TENANT: window.TENANT,
    APP:    {
      NAME:        "Kadem & Zetu School Management System",
      VERSION:     "5.3.0",
      ENVIRONMENT: isLocal ? "development" : "production",
    },
  };

  if (isLocal || window.location.search.includes("debug=1")) {
    console.log("[Kadem & Zetu SMS] Config:", {
      API_BASE: window.API_BASE,
      TENANT: window.TENANT,
      TOKEN_KEY: window.STORAGE_KEYS.TOKEN,
    });
  }
})();
