/**
 * Kadem & Zetu School Management System — Cloudflare Worker v2.4
 *
 * Env vars required:
 *   BACKEND_URL = https://your-service.onrender.com
 */

const ROOT_DOMAIN = "cbc-school-erp.pages.dev";

// Pages that exist as .html files — resolve clean URLs to them
const HTML_PAGES = [
  "school-admin", "super-admin", "teacher", "bursar",
  "login", "subscription", "change-password"
];

function getAllowedOrigin(requestOrigin) {
  if (!requestOrigin) return `https://${ROOT_DOMAIN}`;
  if (requestOrigin === `https://${ROOT_DOMAIN}`) return requestOrigin;
  if (requestOrigin.match(new RegExp(`^https://[a-z0-9-]+\\.${ROOT_DOMAIN.replace(".", "\\.")}$`))) {
    return requestOrigin;
  }
  if (requestOrigin.match(/^http:\/\/localhost(:\d+)?$/)) return requestOrigin;
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

      const targetUrl    = backendUrl + url.pathname + url.search;
      const proxyHeaders = new Headers(request.headers);
      proxyHeaders.delete("Origin");

      const subdomain = url.hostname.replace(`.${ROOT_DOMAIN}`, "").toUpperCase();
      if (subdomain && subdomain !== ROOT_DOMAIN.toUpperCase()) {
        proxyHeaders.set("X-School-Code", subdomain === "ADMIN" ? "SUPER_ADMIN" : subdomain);
      }

      try {
        const response   = await fetch(new Request(targetUrl, {
          method:   request.method,
          headers:  proxyHeaders,
          body:     ["GET", "HEAD"].includes(request.method) ? null : request.body,
          redirect: "follow",
        }));
        const newHeaders = new Headers(response.headers);
        Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
        return new Response(response.body, { status: response.status, headers: newHeaders });
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, message: "Backend unreachable — please wait 30–60 seconds and try again." }),
          { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // ── Clean URL → .html rewrite (no redirect, no loop) ───────────
    // e.g. /school-admin → rewrite request URL to /school-admin.html
    // then pass to ASSETS. This never loops because ASSETS doesn't
    // re-invoke the worker.
    const pageName = url.pathname.replace(/^\//, "").replace(/\/$/, "");
    if (HTML_PAGES.includes(pageName)) {
      const rewritten = new URL(request.url);
      rewritten.pathname = `/${pageName}.html`;
      return env.ASSETS.fetch(new Request(rewritten.toString(), request));
    }

    // ── All other requests → static assets as-is ───────────────────
    return env.ASSETS.fetch(request);
  }
};
