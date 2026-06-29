/**
 * Cloudflare Workers entry point — wraps the Express app.
 *
 * Uses nodejs_compat to support Node.js core APIs (crypto, Buffer, etc.)
 * and the `pg` driver via Neon's pooled connection string.
 *
 * Env vars are injected by Workers runtime; we copy them to process.env
 * so all existing Express code (db.js, middleware, routes) works unchanged.
 */
"use strict";

// ── Polyfill process.env from Workers env bindings ───────────────
// Workers don't have process.env — we bridge it here before any
// require() call loads modules that read process.env at import time.
function injectEnv(env) {
  if (!globalThis.process) globalThis.process = { env: {} };
  const vars = [
    "NODE_ENV", "JWT_SECRET", "JWT_EXPIRES", "DATABASE_URL",
    "ALLOWED_ORIGINS", "PAYSTACK_SECRET_KEY", "PAYSTACK_CALLBACK_URL",
    "GROQ_API_KEY", "GROQ_MODEL", "PLATFORM_SUPPORT_EMAIL",
    "DB_POOL_MIN", "DB_POOL_MAX",
  ];
  for (const k of vars) {
    if (env[k] !== undefined) process.env[k] = env[k];
  }
}

// ── Lazy-load the Express app (after env is set) ─────────────────
let _app = null;
function getApp(env) {
  if (_app) return _app;
  injectEnv(env);
  // Suppress listen() — Workers don't use TCP ports
  const http = require("http");
  http.Server.prototype.listen = function () { return this; };
  _app = require("./server.js");
  return _app;
}

// ── Convert a Workers Request → Node IncomingMessage (duck-typed) ─
async function toNodeRequest(request, env) {
  const url = new URL(request.url);
  const bodyBuffer = ["GET", "HEAD"].includes(request.method)
    ? null
    : Buffer.from(await request.arrayBuffer());

  return {
    method:  request.method,
    url:     url.pathname + url.search,
    headers: Object.fromEntries(request.headers.entries()),
    body:    bodyBuffer,
    // Express reads socket.remoteAddress for logging
    socket:  { remoteAddress: request.headers.get("cf-connecting-ip") || "127.0.0.1" },
  };
}

// ── Convert a Node ServerResponse → Workers Response ─────────────
function toWorkersResponse(nodeRes, body) {
  const headers = new Headers();
  const raw = nodeRes.getHeaders();
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) v.forEach(val => headers.append(k, String(val)));
    else if (v !== undefined) headers.set(k, String(v));
  }
  return new Response(body || null, { status: nodeRes.statusCode || 200, headers });
}

// ── Main Workers fetch handler ────────────────────────────────────
export default {
  async fetch(request, env) {
    const app = getApp(env);

    const nodeReq = await toNodeRequest(request, env);

    return new Promise((resolve, reject) => {
      // Minimal duck-typed ServerResponse
      const chunks = [];
      const nodeRes = {
        statusCode: 200,
        _headers: {},
        getHeaders() { return this._headers; },
        getHeader(k) { return this._headers[k.toLowerCase()]; },
        setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
        removeHeader(k) { delete this._headers[k.toLowerCase()]; },
        hasHeader(k) { return k.toLowerCase() in this._headers; },
        end(chunk) {
          if (chunk) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          resolve(toWorkersResponse(this, Buffer.concat(chunks)));
        },
        write(chunk) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
          return true;
        },
        // Express needs these on the response object
        on() { return this; },
        once() { return this; },
        emit() { return this; },
      };

      try {
        // Feed the request into Express
        app(nodeReq, nodeRes, (err) => {
          if (err) {
            console.error("[worker] Express next(err):", err.message);
            resolve(new Response(
              JSON.stringify({ success: false, message: "Internal server error." }),
              { status: 500, headers: { "Content-Type": "application/json" } }
            ));
          }
        });
      } catch (err) {
        console.error("[worker] Unhandled:", err.message);
        reject(err);
      }
    });
  },
};
