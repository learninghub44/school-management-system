/**
 * CBC School ERP — Frontend Configuration v5.2
 *
 * TENANT DETECTION (priority order):
 *  1. ?school=CODE or ?school=ADMIN  query param  (works on any domain, easiest for testing)
 *  2. Subdomain on custom domain       kpri001.yourdomain.co.ke
 *  3. Subdomain on pages.dev           kpri001.cbc-school-erp.pages.dev
 *  4. Root domain / local dev          → GUEST (user must type school code manually)
 *
 * SUPER_ADMIN login:
 *  - Use ?school=ADMIN on any URL, OR
 *  - Use admin.yourdomain.co.ke subdomain, OR
 *  - Leave school code blank and just don't supply a school_code (GUEST mode)
 */
(function () {
  const hostname = window.location.hostname;
  const isLocal  = hostname === "localhost" || hostname === "127.0.0.1";

  const PAGES_DOMAIN  = "cbc-school-erp.pages.dev";
  const CUSTOM_DOMAIN = "yourdomain.co.ke"; // ← update when you have a domain

  function detectTenant() {
    // 1. Query param — highest priority, works everywhere for testing
    //    ?school=KPRI001 or ?school=ADMIN
    const params = new URLSearchParams(window.location.search);
    const sc = params.get("school")?.toUpperCase();
    if (sc) return sc === "ADMIN" ? "SUPER_ADMIN" : sc;

    // 2. Custom domain subdomain
    if (CUSTOM_DOMAIN !== "yourdomain.co.ke" && hostname.endsWith("." + CUSTOM_DOMAIN)) {
      const sub = hostname.split(".")[0].toUpperCase();
      return sub === "ADMIN" ? "SUPER_ADMIN" : sub;
    }

    // 3. pages.dev subdomain
    if (hostname !== PAGES_DOMAIN && hostname.endsWith("." + PAGES_DOMAIN)) {
      const sub = hostname.split(".")[0].toUpperCase();
      return sub === "ADMIN" ? "SUPER_ADMIN" : sub;
    }

    // 4. Local dev override
    if (isLocal && window.__DEV_SCHOOL_CODE__) return window.__DEV_SCHOOL_CODE__;

    // 5. Root domain / unknown — GUEST (manual school code entry)
    return "GUEST";
  }

  const tenant    = detectTenant();
  const tenantKey = tenant; // "SUPER_ADMIN", "KPRI001", or "GUEST"

  // Storage keys scoped per tenant to prevent cross-school bleed
  window.STORAGE_KEYS = {
    TOKEN: "cbc_token_" + tenantKey,
    USER:  "cbc_user_"  + tenantKey,
  };

  // API base — same-origin via _worker.js proxy on Cloudflare Pages
  window.API_BASE = isLocal
    ? "http://localhost:3000/api"   // ← fixed: was 5000, server uses 3000
    : window.location.origin + "/api";

  window.TENANT = {
    schoolCode:   (tenant === "SUPER_ADMIN" || tenant === "GUEST") ? null : tenant,
    isSuperAdmin: tenant === "SUPER_ADMIN",
    isGuest:      tenant === "GUEST",
    raw:          tenant,
  };

  window.CONFIG = {
    API:    { BASE_URL: window.API_BASE },
    AUTH:   { TOKEN_KEY: window.STORAGE_KEYS.TOKEN, USER_KEY: window.STORAGE_KEYS.USER },
    TENANT: window.TENANT,
    APP:    {
      NAME:        "CBC School ERP",
      VERSION:     "5.2.0",
      ENVIRONMENT: isLocal ? "development" : "production",
    },
  };

  if (isLocal || window.location.search.includes("debug=1")) {
    console.log("[CBC ERP] Config:", {
      tenant, API_BASE: window.API_BASE,
      TOKEN_KEY: window.STORAGE_KEYS.TOKEN,
    });
  }
})();
