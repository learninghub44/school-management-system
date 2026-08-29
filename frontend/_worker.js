// Set BACKEND_URL in Cloudflare Pages → Settings → Environment variables
// (per environment: Production / Preview) to point at wherever the backend
// API actually lives — a Cloudflare Worker, Railway, Render, a VPS, etc.
// Falls back to the value below only if the env var isn't set.
const DEFAULT_BACKEND_URL = "https://school-management-system.chrisodhiambo444.workers.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api")) {
      return env.ASSETS.fetch(request);
    }

    const BACKEND_URL = env.BACKEND_URL || DEFAULT_BACKEND_URL;
    const target = BACKEND_URL + url.pathname + url.search;

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
