/**
 * Cloudflare Pages Worker — API proxy
 *
 * Proxies all /api/* requests to the Render backend.
 * Set BACKEND_URL in your Cloudflare Pages environment variables:
 *   BACKEND_URL=https://kadem-zetu-sms-api.onrender.com
 *
 * Everything else is served as a static asset from the Pages build.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Only intercept /api/* paths
    if (!url.pathname.startsWith("/api")) {
      // Let Cloudflare Pages serve the static asset
      return env.ASSETS.fetch(request);
    }

    const backendUrl = env.BACKEND_URL;
    if (!backendUrl) {
      return new Response(
        JSON.stringify({ success: false, message: "BACKEND_URL not configured." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build the proxied URL
    const target = backendUrl.replace(/\/$/, "") + url.pathname + url.search;

    // Clone the request with the new URL, forwarding all headers and body
    const proxied = new Request(target, {
      method:  request.method,
      headers: request.headers,
      body:    ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
      redirect: "follow",
    });

    try {
      const response = await fetch(proxied);

      // Pass through the response, adding CORS headers just in case
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
