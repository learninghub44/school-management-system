/**
 * CBC School ERP — Frontend Configuration v5.1
 * Multi-tenant subdomain architecture
 *
 * Tenant detection priority:
 *  1. Subdomain  — kpri001.yourdomain.co.ke   (production with custom domain)
 *  2. Query param — ?school=KPRI001            (testing on pages.dev)
 *  3. Local dev   — window.__DEV_SCHOOL_CODE__ (set in browser console)
 */
(function () {
  const hostname = window.location.hostname;
  const isLocal  = hostname === "localhost" || hostname === "127.0.0.1";

  // ── Your domains ──────────────────────────────────────────────────
  const PAGES_DOMAIN  = "cbc-school-erp.pages.dev";   // Cloudflare Pages (current)
  const CUSTOM_DOMAIN = "yourdomain.co.ke";            // ← UPDATE when you buy a domain

  // ── Tenant detection ──────────────────────────────────────────────
  function detectTenant() {
    // 1. Local dev — set in browser console: window.__DEV_SCHOOL_CODE__ = "KPRI001"
    if (isLocal) return window.__DEV_SCHOOL_CODE__ || null;

    // 2. Custom domain subdomain (production)
    //    admin.yourdomain.co.ke    → SUPER_ADMIN
    //    kpri001.yourdomain.co.ke  → KPRI001
    if (CUSTOM_DOMAIN !== "yourdomain.co.ke" && hostname.endsWith("." + CUSTOM_DOMAIN)) {
      const sub = hostname.replace("." + CUSTOM_DOMAIN, "").toUpperCase();
      return sub === "ADMIN" ? "SUPER_ADMIN" : sub || null;
    }

    // 3. pages.dev subdomain (works once Cloudflare supports wildcard — needs custom domain)
    if (hostname.endsWith("." + PAGES_DOMAIN)) {
      const sub = hostname.replace("." + PAGES_DOMAIN, "").toUpperCase();
      return sub === "ADMIN" ? "SUPER_ADMIN" : sub || null;
    }

    // 4. Query param fallback — for testing on pages.dev without a custom domain
    //    cbc-school-erp.pages.dev/login.html?school=ADMIN
    //    cbc-school-erp.pages.dev/login.html?school=KPRI001
    const params = new URLSearchParams(window.location.search);
    const sc = params.get("school")?.toUpperCase();
    if (sc) return sc === "ADMIN" ? "SUPER_ADMIN" : sc;

    return null; // Root domain — landing page
  }

  const tenant = detectTenant();
  const tenantKey = tenant || "GUEST";

  // ── Storage keys scoped per tenant ────────────────────────────────
  window.STORAGE_KEYS = {
    TOKEN: `cbc_token_${tenantKey}`,
    USER:  `cbc_user_${tenantKey}`,
  };

  // ── API base ──────────────────────────────────────────────────────
  window.API_BASE = isLocal
    ? "http://localhost:5000/api"
    : window.location.origin + "/api";

  // ── Tenant info ───────────────────────────────────────────────────
  window.TENANT = {
    schoolCode:   tenant === "SUPER_ADMIN" ? null : tenant,
    isSuperAdmin: tenant === "SUPER_ADMIN",
    isRoot:       tenant === null,
    raw:          tenant,
  };

  window.CONFIG = {
    API:    { BASE_URL: window.API_BASE },
    AUTH:   { TOKEN_KEY: window.STORAGE_KEYS.TOKEN, USER_KEY: window.STORAGE_KEYS.USER },
    TENANT: window.TENANT,
    APP:    {
      NAME:        "CBC School ERP",
      VERSION:     "5.1.0",
      ENVIRONMENT: isLocal ? "development" : "production",
    },
  };

  if (isLocal || window.location.search.includes("debug=1")) {
    console.log("CBC ERP config:", window.CONFIG);
  }
})();
