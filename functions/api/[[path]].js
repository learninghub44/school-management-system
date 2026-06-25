/**
 * Kadem & Zetu School Management System
 * Cloudflare Pages Function — proxies /api/* to Render backend
 *
 * BACKEND_URL = https://xxx.onrender.com  (no trailing /api)
 * Requests to /api/auth/login → forwarded as /api/auth/login
 */

const ROOT_DOMAIN = "cbc-school-erp.pages.dev";

function getAllowedOrigin(requestOrigin) {
  if (!requestOrigin) return `https://${ROOT_DOMAIN}`;
  if (requestOrigin === `https://${ROOT_DOMAIN}`) return requestOrigin;
  if (requestOrigin.match(new RegExp(`^https://[a-z0-9-]+\\.${ROOT_DOMAIN.replace(".", "\\.")}$`))) return requestOrigin;
  if (requestOrigin.match(/^http:\/\/localhost(:\d+)?$/)) return requestOrigin;
  return `https://${ROOT_DOMAIN}`;
}

export async function onRequest({ request, env }) {
  const url         = new URL(request.url);
  const origin      = request.headers.get("Origin") || "";
  const allowOrigin = getAllowedOrigin(origin);

  const corsHeaders = {
    "Access-Control-Allow-Origin":      allowOrigin,
    "Access-Control-Allow-Methods":     "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":     "Content-Type,Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age":           "600",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const backendUrl = (env.BACKEND_URL || "").replace(/\/$/, "");
  if (!backendUrl) {
    return new Response(
      JSON.stringify({ success: false, message: "BACKEND_URL not configured." }),
      { status: 503, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  // BACKEND_URL has no /api suffix; url.pathname is /api/...
  // so targetUrl = https://xxx.onrender.com/api/auth/login ✓
  const targetUrl = backendUrl + url.pathname + url.search;

  // Explicitly whitelist headers — CF Workers silently drops Authorization
  // when copying all headers via new Headers(request.headers) for cross-origin fetches.
  const proxyHeaders = new Headers();
  for (const h of ["authorization", "content-type", "accept", "accept-language", "x-requested-with", "cache-control"]) {
    const val = request.headers.get(h);
    if (val) proxyHeaders.set(h, val);
  }

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
