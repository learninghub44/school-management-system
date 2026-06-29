/**
 * Cloudflare Workers entry — ESM wrapper around the CJS Express app.
 * Must use ESM (export default) so wrangler treats it as ES Module Worker.
 * nodejs_compat flag gives us Node.js core APIs (crypto, Buffer, stream, etc.)
 */

// ── Inject Workers env → process.env before any require() ────────
function injectEnv(env) {
  if (!globalThis.process) globalThis.process = {};
  if (!globalThis.process.env) globalThis.process.env = {};
  if (!globalThis.process.on) globalThis.process.on = () => {};
  if (!globalThis.process.exit) globalThis.process.exit = () => {};
  const keys = [
    "NODE_ENV","JWT_SECRET","JWT_EXPIRES","DATABASE_URL",
    "ALLOWED_ORIGINS","PAYSTACK_SECRET_KEY","PAYSTACK_CALLBACK_URL",
    "GROQ_API_KEY","GROQ_MODEL","PLATFORM_SUPPORT_EMAIL",
    "DB_POOL_MIN","DB_POOL_MAX",
  ];
  for (const k of keys) {
    if (env[k] !== undefined) globalThis.process.env[k] = env[k];
  }
}

// ── Complete ServerResponse shim ──────────────────────────────────
function makeNodeRes(resolve) {
  const chunks = [];
  const hdrs   = {};
  const res    = {
    statusCode: 200,
    statusMessage: "OK",
    finished: false,
    headersSent: false,
    writableEnded: false,
    locals: {},

    getHeaders()    { return { ...hdrs }; },
    getHeader(k)    { return hdrs[k.toLowerCase()]; },
    getHeaderNames(){ return Object.keys(hdrs); },
    hasHeader(k)    { return k.toLowerCase() in hdrs; },
    setHeader(k,v)  { hdrs[k.toLowerCase()] = v; return res; },
    removeHeader(k) { delete hdrs[k.toLowerCase()]; },
    writeHead(code, msg, h) {
      if (typeof msg === "object") { h = msg; }
      res.statusCode = code;
      if (h) Object.entries(h).forEach(([k,v]) => res.setHeader(k,v));
      res.headersSent = true;
      return res;
    },
    write(chunk, enc, cb) {
      if (chunk) chunks.push(typeof chunk === "string" ? Buffer.from(chunk, enc||"utf8") : chunk);
      if (typeof enc === "function") enc();
      else if (typeof cb === "function") cb();
      return true;
    },
    end(chunk, enc, cb) {
      if (chunk) chunks.push(typeof chunk === "string" ? Buffer.from(chunk, enc||"utf8") : chunk);
      res.finished = res.writableEnded = true;
      const body    = chunks.length ? Buffer.concat(chunks) : null;
      const headers = new Headers();
      for (const [k,v] of Object.entries(hdrs)) {
        if (Array.isArray(v)) v.forEach(val => headers.append(k, String(val)));
        else if (v != null) headers.set(k, String(v));
      }
      resolve(new Response(body, { status: res.statusCode, headers }));
      if (typeof enc === "function") enc();
      else if (typeof cb === "function") cb();
      return res;
    },
    on()             { return res; },
    once()           { return res; },
    emit()           { return true; },
    off()            { return res; },
    addListener()    { return res; },
    removeListener() { return res; },
    removeAllListeners() { return res; },
    flushHeaders()   {},
    cork()           {},
    uncork()         {},
  };
  return res;
}

// ── IncomingMessage shim with streaming body ─────────────────────
function makeNodeReq(url, method, headers, bodyBuf, ip) {
  const parsed = new URL(url);
  const rawHeaders = {};
  for (const [k,v] of headers) rawHeaders[k.toLowerCase()] = v;

  const listeners = {};
  function on(evt, cb) {
    if (!listeners[evt]) listeners[evt] = [];
    listeners[evt].push(cb);
    if (evt === "data" && bodyBuf && bodyBuf.length) {
      setImmediate(() => cb(bodyBuf));
    }
    if (evt === "end") {
      setImmediate(() => cb());
    }
    return req;
  }

  const req = {
    method,
    url:         parsed.pathname + parsed.search,
    originalUrl: parsed.pathname + parsed.search,
    path:        parsed.pathname,
    headers:     rawHeaders,
    rawHeaders:  [],
    httpVersion: "1.1",
    socket:      { remoteAddress: ip, encrypted: true },
    connection:  { remoteAddress: ip },
    complete:    true,
    readable:    true,
    _body:       false,
    body:        undefined,

    on,
    once: on,
    addListener: on,
    off()              { return req; },
    removeListener()   { return req; },
    removeAllListeners(){ return req; },
    emit()             { return true; },
    pipe()             { return req; },
    resume()           { return req; },
    pause()            { return req; },
    destroy()          { return req; },
    setEncoding()      { return req; },
    unpipe()           { return req; },
  };
  return req;
}

// ── Lazy-loaded app ───────────────────────────────────────────────
let _app = null;
function getApp() {
  if (!_app) _app = require("./server.js");
  return _app;
}

// ── ESM default export — required for ES Module Workers ──────────
export default {
  async fetch(request, env) {
    // Inject env FIRST, before getApp() triggers any require()
    injectEnv(env);

    const app = getApp();
    const ip  = request.headers.get("cf-connecting-ip") || "127.0.0.1";
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
          const status  = err ? (err.status || 500) : 404;
          const message = err
            ? (globalThis.process?.env?.NODE_ENV === "production" ? "Internal server error." : err.message)
            : "Not found.";
          resolve(new Response(
            JSON.stringify({ success: false, message }),
            { status, headers: { "Content-Type": "application/json" } }
          ));
        });
      } catch (err) {
        console.error("[worker] Exception:", err.message);
        resolve(new Response(
          JSON.stringify({ success: false, message: "Worker exception." }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        ));
      }
    });
  },
};
