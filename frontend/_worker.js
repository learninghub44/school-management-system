export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle CORS preflight FIRST
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "https://cbc-school-erp.pages.dev",
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,Authorization",
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Max-Age": "600",
        },
      });
    }

    // Proxy /api/* to Render backend
    if (url.pathname.startsWith("/api/")) {
      const backendUrl = (env.BACKEND_URL || "").replace(/\/$/, "");

      if (!backendUrl) {
        return new Response(
          JSON.stringify({ success: false, message: "BACKEND_URL not configured." }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }

      const targetUrl = backendUrl + url.pathname + url.search;

      const proxyHeaders = new Headers(request.headers);
      proxyHeaders.delete("Origin");

      const proxyRequest = new Request(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
        body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
        redirect: "follow",
      });

      try {
        const response = await fetch(proxyRequest);

        const newHeaders = new Headers(response.headers);
        newHeaders.set("Access-Control-Allow-Origin", "https://cbc-school-erp.pages.dev");
        newHeaders.set("Access-Control-Allow-Credentials", "true");

        return new Response(response.body, {
          status: response.status,
          headers: newHeaders,
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ success: false, message: "Backend unreachable." }),
          { status: 502, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Serve static files
    return env.ASSETS.fetch(request);
  }
};