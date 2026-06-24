/**
 * Kadem & Zetu School Management System — Cloudflare Worker v2.0
 * Multi-tenant subdomain proxy
 *
 * Routes:
 *   *.cbc-school-erp.pages.dev/api/* → BACKEND_URL (Render)
 *   *.cbc-school-erp.pages.dev/*     → static assets (Cloudflare Pages)
 *
 * Env vars required (set in Cloudflare Pages → Settings → Environment Variables):
 *   BACKEND_URL = https://your-service.onrender.com
 */

const ROOT_DOMAIN = "cbc-school-erp.pages.dev";

function getAllowedOrigin(requestOrigin) {
  if (!requestOrigin) return `https://${ROOT_DOMAIN}`;
  // Allow root domain
  if (requestOrigin === `https://${ROOT_DOMAIN}`) return requestOrigin;
  // Allow any subdomain: kpri001.cbc-school-erp.pages.dev, admin.cbc-school-erp.pages.dev
  if (requestOrigin.match(new RegExp(`^https://[a-z0-9-]+\\.${ROOT_DOMAIN.replace(".", "\\.")}$`))) {
    return requestOrigin;
  }
  // Allow local dev
  if (requestOrigin.match(/^http:\/\/localhost(:\d+)?$/)) return requestOrigin;
  // Fallback
  return `https://${ROOT_DOMAIN}`;
}

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = getAllowedOrigin(origin);

    const corsHeaders = {
      "Access-Control-Allow-Origin":      allowOrigin,
      "Access-Control-Allow-Methods":     "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":     "Content-Type,Authorization",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age":           "600",
    };

    // ── CORS preflight ──────────────────────────────────────────────
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ── Proxy /api/* → Render backend ───────────────────────────────
    if (url.pathname.startsWith("/api/")) {
      const backendUrl = (env.BACKEND_URL || "").replace(/\/$/, "");

      if (!backendUrl) {
        return new Response(
          JSON.stringify({ success: false, message: "BACKEND_URL not configured." }),
          { status: 503, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      const targetUrl   = backendUrl + url.pathname + url.search;
      const proxyHeaders = new Headers(request.headers);
      proxyHeaders.delete("Origin");

      // Forward the school subdomain to backend for context (optional but useful for logging)
      const subdomain = url.hostname.replace(`.${ROOT_DOMAIN}`, "").toUpperCase();
      if (subdomain && subdomain !== ROOT_DOMAIN.toUpperCase()) {
        proxyHeaders.set("X-School-Code", subdomain === "ADMIN" ? "SUPER_ADMIN" : subdomain);
      }

      const proxyRequest = new Request(targetUrl, {
        method:   request.method,
        headers:  proxyHeaders,
        body:     ["GET", "HEAD"].includes(request.method) ? null : request.body,
        redirect: "follow",
      });

      try {
        const response   = await fetch(proxyRequest);
        const newHeaders = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));

        return new Response(response.body, {
          status:  response.status,
          headers: newHeaders,
        });

      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, message: "Backend unreachable. It may be starting up — please wait 30–60 seconds and try again." }),
          { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // ── Serve static assets ─────────────────────────────────────────
    return env.ASSETS.fetch(request);
  }
};
