/**
 * Cloudflare Pages Worker — API proxy
 *
 * Proxies all /api/* requests to the Cloudflare Workers backend.
 * Set BACKEND_URL in Cloudflare Pages → Settings → Environment Variables:
 *   BACKEND_URL=https://cbc-school-erp-api.<your-subdomain>.workers.dev
 *
 * Everything else is served as a static asset from Pages.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Serve static assets for non-API paths
    if (!url.pathname.startsWith("/api")) {
      return env.ASSETS.fetch(request);
    }

    const backendUrl = env.BACKEND_URL;
    if (!backendUrl) {
      return new Response(
        JSON.stringify({ success: false, message: "BACKEND_URL not configured." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build proxied URL
    const target = backendUrl.replace(/\/$/, "") + url.pathname + url.search;

    const proxied = new Request(target, {
      method:  request.method,
      headers: request.headers,
      body:    ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "follow",
    });

    try {
      const response = await fetch(proxied);
      const newHeaders = new Headers(response.headers);
      newHeaders.set("X-Proxied-By", "CF-Pages-Worker");
      return new Response(response.body, {
        status:  response.status,
        headers: newHeaders,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, message: "Backend unreachable.", detail: err.message }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};
