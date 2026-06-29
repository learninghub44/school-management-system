/**
 * Cloudflare Workers entry — CJS wrapper around the Express app.
 * nodejs_compat mode: supports Node.js core APIs, crypto, Buffer, pg, etc.
 *
 * The module type is "commonjs" (set in package.json), so we export
 * the fetch handler via module.exports. Wrangler picks this up correctly.
 */
"use strict";

// ── Inject Workers env bindings → process.env ────────────────────
// Must happen before any require() that reads process.env at load time.
function injectEnv(env) {
  const p = globalThis.process || (globalThis.process = { env: {}, on() {}, exit() {} });
  if (!p.env) p.env = {};
  const keys = [
    "NODE_ENV","JWT_SECRET","JWT_EXPIRES","DATABASE_URL",
    "ALLOWED_ORIGINS","PAYSTACK_SECRET_KEY","PAYSTACK_CALLBACK_URL",
    "GROQ_API_KEY","GROQ_MODEL","PLATFORM_SUPPORT_EMAIL",
    "DB_POOL_MIN","DB_POOL_MAX",
  ];
  for (const k of keys) {
    if (env[k] !== undefined) p.env[k] = env[k];
  }
}

// ── Build complete duck-typed ServerResponse ──────────────────────
function makeNodeRes(resolve) {
  const chunks = [];
  const headers = {};

  const res = {
    statusCode: 200,
    statusMessage: "OK",
    finished: false,
    headersSent: false,
    writableEnded: false,

    // Header methods
    getHeaders()       { return { ...headers }; },
    getHeader(k)       { return headers[k.toLowerCase()]; },
    getHeaderNames()   { return Object.keys(headers); },
    hasHeader(k)       { return k.toLowerCase() in headers; },
    setHeader(k, v)    { headers[k.toLowerCase()] = v; return res; },
    removeHeader(k)    { delete headers[k.toLowerCase()]; },
    writeHead(code, msg, hdrs) {
      if (typeof msg === "object") { hdrs = msg; msg = undefined; }
      res.statusCode = code;
      if (hdrs) Object.entries(hdrs).forEach(([k,v]) => res.setHeader(k, v));
      res.headersSent = true;
      return res;
    },

    // Body methods
    write(chunk, encoding, cb) {
      if (chunk) {
        const buf = typeof chunk === "string" ? Buffer.from(chunk, encoding || "utf8") : chunk;
        chunks.push(buf);
      }
      if (typeof encoding === "function") encoding();
      else if (typeof cb === "function") cb();
      return true;
    },
    end(chunk, encoding, cb) {
      if (chunk) {
        const buf = typeof chunk === "string" ? Buffer.from(chunk, encoding || "utf8") : chunk;
        chunks.push(buf);
      }
      res.finished = true;
      res.writableEnded = true;

      const body = chunks.length ? Buffer.concat(chunks) : null;
      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(headers)) {
        if (Array.isArray(v)) v.forEach(val => resHeaders.append(k, String(val)));
        else if (v != null) resHeaders.set(k, String(v));
      }

      resolve(new Response(body, { status: res.statusCode, headers: resHeaders }));

      if (typeof encoding === "function") encoding();
      else if (typeof cb === "function") cb();
      return res;
    },

    // Event emitter stubs (Express calls these)
    on()         { return res; },
    once()       { return res; },
    emit()       { return true; },
    off()        { return res; },
    addListener(){ return res; },
    removeListener(){ return res; },

    // Express-specific
    locals: {},
    app: null,
    req: null,
  };

  return res;
}

// ── Build duck-typed IncomingMessage ─────────────────────────────
function makeNodeReq(url, method, headers, body, ip) {
  const parsed = new URL(url);
  const req = {
    method,
    url:          parsed.pathname + parsed.search,
    originalUrl:  parsed.pathname + parsed.search,
    path:         parsed.pathname,
    query:        Object.fromEntries(parsed.searchParams),
    headers:      Object.fromEntries([...headers].map(([k,v]) => [k.toLowerCase(), v])),
    rawHeaders:   [],
    httpVersion:  "1.1",
    connection:   { remoteAddress: ip },
    socket:       { remoteAddress: ip },
    body:         undefined,  // express.json() will set this
    _body:        false,
    complete:     true,
    readable:     true,

    // Stream methods (express body parser reads the stream)
    pipe()    { return req; },
    resume()  { return req; },
    pause()   { return req; },
    destroy() { return req; },
    setEncoding() { return req; },

    // Event emitter stubs
    on(event, cb) {
      if (event === "data" && body && body.length) {
        // Emit body chunks synchronously — body parsers read this
        setImmediate(() => cb(body));
      }
      if (event === "end") {
        setImmediate(() => cb());
      }
      return req;
    },
    once(event, cb) { return req.on(event, cb); },
    emit()    { return true; },
    off()     { return req; },
    removeListener() { return req; },
    addListener(event, cb) { return req.on(event, cb); },
    removeAllListeners() { return req; },

    // Express reads these
    app: null,
    res: null,
  };
  return req;
}

// ── Lazy-load Express app ─────────────────────────────────────────
let _app = null;
function getApp(env) {
  if (_app) return _app;
  injectEnv(env);
  _app = require("./server.js");
  return _app;
}

// ── Fetch handler ─────────────────────────────────────────────────
async function handleFetch(request, env) {
  const app = getApp(env);

  const ip = request.headers.get("cf-connecting-ip") || "127.0.0.1";
  const bodyBuf = ["GET","HEAD","OPTIONS"].includes(request.method)
    ? null
    : Buffer.from(await request.arrayBuffer());

  const nodeReq = makeNodeReq(request.url, request.method, request.headers, bodyBuf, ip);

  return new Promise((resolve) => {
    const nodeRes = makeNodeRes(resolve);
    nodeRes.req = nodeReq;
    nodeReq.res = nodeRes;

    try {
      app(nodeReq, nodeRes, (err) => {
        // Express called next() with no handler — 404
        const msg = err
          ? (process.env.NODE_ENV === "production" ? "Internal server error." : err.message)
          : "Not found.";
        const status = err ? (err.status || 500) : 404;
        resolve(new Response(
          JSON.stringify({ success: false, message: msg }),
          { status, headers: { "Content-Type": "application/json" } }
        ));
      });
    } catch (err) {
      console.error("[worker] Unhandled exception:", err.message, err.stack);
      resolve(new Response(
        JSON.stringify({ success: false, message: "Worker exception." }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      ));
    }
  });
}

module.exports = { fetch: handleFetch };
