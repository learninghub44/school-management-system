/**
 * Cloudflare Workers entry — ESM wrapper around the CJS Express app.
 *
 * Stubbing strategy: wrangler [alias] in wrangler.toml redirects
 * compression / morgan / express-rate-limit to no-op stubs at bundle time.
 * No runtime module patching needed.
 */
import { createRequire } from "module";
import { Buffer }        from "buffer";

const require = createRequire("/worker-entry.js");

// ── Patch process so startup guards don't crash the Worker ────────
if (!globalThis.process)     globalThis.process     = {};
if (!globalThis.process.env) globalThis.process.env = {};
if (!globalThis.process.on)  globalThis.process.on  = () => {};
// Replace exit with throw — prevents JWT/DATABASE_URL guards from killing Worker
globalThis.process.exit = (code) => {
  throw new Error(`[worker] process.exit(${code}) — check JWT_SECRET / DATABASE_URL secrets`);
};

// ── Inject Workers env bindings → process.env ─────────────────────
function injectEnv(env) {
  const keys = [
    "NODE_ENV","JWT_SECRET","JWT_EXPIRES","DATABASE_URL",
    "ALLOWED_ORIGINS","PAYSTACK_SECRET_KEY","PAYSTACK_CALLBACK_URL",
    "GROQ_API_KEY","GROQ_MODEL","PLATFORM_SUPPORT_EMAIL",
    "DB_POOL_MIN","DB_POOL_MAX",
  ];
  for (const k of keys) {
    if (env[k] !== undefined) globalThis.process.env[k] = String(env[k]);
  }
}

// ── Lazy-load Express app (after env is patched) ──────────────────
let _app = null;
function getApp(env) {
  if (_app) return _app;
  injectEnv(env);
  // Re-patch exit after injection (server.js runs its own guards on require)
  globalThis.process.exit = (code) => {
    throw new Error(`[worker] startup guard failed (exit ${code}) — missing secret`);
  };
  _app = require("./server.js");
  return _app;
}

// ── Shim: Workers Request → Node-style req ────────────────────────
function makeNodeReq(request, bodyBuf) {
  const url  = new URL(request.url);
  const hdrs = {};
  for (const [k, v] of request.headers.entries()) hdrs[k.toLowerCase()] = v;

  return {
    method:     request.method,
    url:        url.pathname + url.search,
    path:       url.pathname,
    query:      Object.fromEntries(url.searchParams),
    headers:    hdrs,
    body:       null,
    params:     {},
    // Fake Node.js Readable so express.json() body-parser can read the buffer
    on(ev, fn)       { if (ev === "data" && bodyBuf?.byteLength) fn(Buffer.from(bodyBuf)); if (ev === "end") fn(); return this; },
    once(ev, fn)     { return this.on(ev, fn); },
    removeListener() { return this; },
    resume()         { return this; },
    pipe(d)          { return d; },
    socket:     { remoteAddress: "127.0.0.1", encrypted: true },
    connection: { remoteAddress: "127.0.0.1" },
    get(h)           { return hdrs[h.toLowerCase()]; },
  };
}

// ── Shim: Node-style res → Workers Response ───────────────────────
function makeNodeRes(resolve) {
  const chunks = [];
  const hdrs   = {};
  let   status = 200;
  let   done   = false;

  const flush = () => {
    if (done) return;
    done = true;
    const body = chunks.length
      ? Buffer.concat(chunks.map(c => Buffer.isBuffer(c) ? c : Buffer.from(String(c))))
      : null;
    resolve(new Response(body, { status, headers: hdrs }));
  };

  return {
    statusCode:  200,
    headersSent: false,
    locals:      {},
    finished:    false,
    setHeader(k, v)  { hdrs[k.toLowerCase()] = String(v); return this; },
    getHeader(k)     { return hdrs[k.toLowerCase()]; },
    removeHeader(k)  { delete hdrs[k.toLowerCase()]; return this; },
    getHeaders()     { return { ...hdrs }; },
    hasHeader(k)     { return k.toLowerCase() in hdrs; },
    writeHead(s, h)  { status = s; if (h) for (const [k,v] of Object.entries(h)) hdrs[k.toLowerCase()] = String(v); return this; },
    write(c)         { chunks.push(c); return true; },
    end(c)           { if (c != null) chunks.push(c); flush(); },
    send(data)       {
      if (!hdrs["content-type"]) hdrs["content-type"] = "application/json";
      if (typeof data === "object" && data !== null) chunks.push(JSON.stringify(data));
      else if (data != null) chunks.push(String(data));
      flush();
    },
    json(data)       { hdrs["content-type"] = "application/json"; chunks.push(JSON.stringify(data)); flush(); },
    status(s)        { status = s; return this; },
    type(t)          { hdrs["content-type"] = t; return this; },
    set(k, v)        { hdrs[k.toLowerCase()] = String(v); return this; },
    get(k)           { return hdrs[k.toLowerCase()]; },
    redirect(s, u)   { if (typeof s === "string") { u = s; s = 302; } status = s; hdrs["location"] = u; flush(); },
    on()             { return this; },
    emit()           { return this; },
    once()           { return this; },
    removeListener() { return this; },
  };
}

// ── Workers fetch handler ─────────────────────────────────────────
export default {
  async fetch(request, env) {
    try {
      const app = getApp(env);

      let bodyBuf = null;
      if (!["GET","HEAD","OPTIONS"].includes(request.method.toUpperCase())) {
        bodyBuf = await request.arrayBuffer();
      }

      return await new Promise((resolve, reject) => {
        const req = makeNodeReq(request, bodyBuf);
        const res = makeNodeRes(resolve);

        if (bodyBuf?.byteLength && !req.headers["content-type"]) {
          req.headers["content-type"] = "application/json";
        }

        const timer = setTimeout(() => reject(new Error("Worker timeout 25s")), 25_000);
        const done  = (fn) => (...args) => { clearTimeout(timer); fn(...args); };

        res.end  = done(res.end.bind(res));
        res.send = done(res.send.bind(res));
        res.json = done(res.json.bind(res));

        try {
          app(req, res, (err) => {
            clearTimeout(timer);
            resolve(new Response(
              JSON.stringify({ error: err ? err.message : "Not Found" }),
              { status: err ? 500 : 404, headers: { "content-type": "application/json" } }
            ));
          });
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      });

    } catch (err) {
      console.error("[worker] Fatal:", err.message);
      return new Response(
        JSON.stringify({ error: "Worker error", detail: err.message }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  },
};
