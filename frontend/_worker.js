/**
 * Cloudflare Pages Worker — API Proxy
 *
 * Routes /api/* → your Render backend
 *
 * SETUP: In Cloudflare Pages → Settings → Environment Variables, add:
 *   BACKEND_URL = https://YOUR-SERVICE.onrender.com
 *
 * This means the frontend just calls /api/... (same origin) and this
 * worker forwards the request to Render — no CORS issues, no URL hardcoding.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Only proxy /api/* paths
    if (url.pathname.startsWith("/api/")) {
      const backendUrl = (env.BACKEND_URL || "").replace(/\/$/, "");

      if (!backendUrl) {
        return new Response(
          JSON.stringify({ success: false, message: "BACKEND_URL not configured in Cloudflare Pages env vars." }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }

      // Build the proxied URL
      const targetUrl = backendUrl + url.pathname + url.search;

      // Forward the request, preserving method, headers, and body
      const proxyRequest = new Request(targetUrl, {
        method:  request.method,
        headers: request.headers,
        body:    ["GET", "HEAD"].includes(request.method) ? null : request.body,
        redirect: "follow",
      });

      try {
        const response = await fetch(proxyRequest);

        // Return the backend response with CORS headers added
        const newHeaders = new Headers(response.headers);
        newHeaders.set("Access-Control-Allow-Origin", url.origin);
        newHeaders.set("Access-Control-Allow-Credentials", "true");

        return new Response(response.body, {
          status:  response.status,
          headers: newHeaders,
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, message: "Backend unreachable. Check BACKEND_URL env var." }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Handle CORS preflight for /api/*
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization",
          "Access-Control-Max-Age": "600",
        },
      });
    }

    // All other requests: serve static files normally
    return env.ASSETS.fetch(request);
  }
};
