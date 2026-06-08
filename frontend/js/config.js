/**
 * CBC School ERP — Frontend Configuration v5.0
 * Multi-tenant subdomain architecture
 *
 * Subdomains:
 *   kpri001.cbc-school-erp.pages.dev  → school tenant login
 *   admin.cbc-school-erp.pages.dev    → SUPER_ADMIN login
 *   cbc-school-erp.pages.dev          → landing page (redirects to subdomain)
 */
(function () {
  const hostname   = window.location.hostname;
  const isLocal    = hostname === "localhost" || hostname === "127.0.0.1";
  const ROOT       = "cbc-school-erp.pages.dev";

  // ── Detect tenant from subdomain ──────────────────────────────────
  // kpri001.cbc-school-erp.pages.dev → "KPRI001"
  // admin.cbc-school-erp.pages.dev   → "SUPER_ADMIN"
  // cbc-school-erp.pages.dev         → null (root/landing)
  function detectTenant() {
    if (isLocal) return window.__DEV_SCHOOL_CODE__ || null; // set in dev console if needed
    if (!hostname.endsWith("." + ROOT)) return null;
    const sub = hostname.replace("." + ROOT, "").toUpperCase();
    if (sub === "ADMIN") return "SUPER_ADMIN";
    return sub || null;
  }

  const tenant = detectTenant();

  // ── Storage keys scoped per tenant ────────────────────────────────
  // Prevents session bleed between different school tabs
  const tenantKey = tenant || "GUEST";
  window.STORAGE_KEYS = {
    TOKEN: `cbc_token_${tenantKey}`,
    USER:  `cbc_user_${tenantKey}`,
  };

  // ── API base — always same-origin, Worker proxies to backend ──────
  window.API_BASE = isLocal
    ? "http://localhost:5000/api"   // Direct to Express locally
    : window.location.origin + "/api"; // Worker proxies on Cloudflare

  // ── Expose tenant info globally ───────────────────────────────────
  window.TENANT = {
    schoolCode:    tenant === "SUPER_ADMIN" ? null : tenant,
    isSuperAdmin:  tenant === "SUPER_ADMIN",
    isRoot:        tenant === null,
    subdomain:     isLocal ? (window.__DEV_SCHOOL_CODE__ || null) : tenant,
    rootDomain:    ROOT,
  };

  window.CONFIG = {
    API:    { BASE_URL: window.API_BASE },
    AUTH:   { TOKEN_KEY: window.STORAGE_KEYS.TOKEN, USER_KEY: window.STORAGE_KEYS.USER },
    TENANT: window.TENANT,
    APP:    {
      NAME:        "CBC School ERP",
      VERSION:     "5.0.0",
      ENVIRONMENT: isLocal ? "development" : "production",
    },
  };

  if (isLocal || window.location.search.includes("debug=1")) {
    console.log("CBC ERP config:", window.CONFIG);
  }
})();
