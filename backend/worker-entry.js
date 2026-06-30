/**
 * Cloudflare Workers entry — ESM.
 *
 * wrangler (esbuild) bundles this + server.js into one file at deploy time.
 * Static `import app from "./server.js"` works because esbuild handles CJS→ESM.
 *
 * Module stubs (compression/morgan/express-rate-limit) are handled by
 * wrangler [alias] in wrangler.toml — esbuild replaces them before bundling.
 *
 * process.exit() guards in server.js are wrapped in `!isWorkerRuntime` checks
 * so they don't fire at module load time in Workers.
 */
import { Buffer } from "buffer";
import app        from "./server.js";

// ── Inject Workers env bindings → process.env per request ─────────
function injectEnv(env) {
  globalThis.WORKER_RUNTIME = true;
  // Store the raw env object so routes can always read secrets reliably
  // (esbuild may inline `undefined` for process.env.X it can't resolve at build time)
  globalThis.WORKER_ENV = env;
  if (!globalThis.process)     globalThis.process     = {};
  if (!globalThis.process.env) globalThis.process.env = {};
  const keys = [
    "NODE_ENV","JWT_SECRET","JWT_EXPIRES","DATABASE_URL",
    "ALLOWED_ORIGINS","PAYSTACK_SECRET_KEY","PAYSTACK_CALLBACK_URL",
    "GROQ_API_KEY","GROQ_MODEL","PLATFORM_SUPPORT_EMAIL",
    "DB_POOL_MIN","DB_POOL_MAX","TURNSTILE_SECRET_KEY",
  ];
  for (const k of keys) {
    if (env[k] !== undefined) globalThis.process.env[k] = String(env[k]);
  }
}

// ── Shim: Workers Request → Node-style req ────────────────────────
function makeNodeReq(request, bodyBuf) {
  const url  = new URL(request.url);
  const hdrs = {};
  for (const [k, v] of request.headers.entries()) hdrs[k.toLowerCase()] = v;

  // Pre-parse body so body-parser stub skips streams entirely
  let _workerBody = undefined;
  if (bodyBuf?.byteLength) {
    const ct = (hdrs["content-type"] || "").split(";")[0].trim();
    try {
      if (ct === "application/x-www-form-urlencoded") {
        _workerBody = Object.fromEntries(new URLSearchParams(Buffer.from(bodyBuf).toString("utf8")));
      } else {
        _workerBody = JSON.parse(Buffer.from(bodyBuf).toString("utf8"));
      }
    } catch { _workerBody = {}; }
  }

  return {
    method:      request.method,
    url:         url.pathname + url.search,
    path:        url.pathname,
    query:       Object.fromEntries(url.searchParams),
    headers:     hdrs,
    body:        null,
    _workerBody,
    params:      {},
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
    statusCode: 200, headersSent: false, locals: {}, finished: false,
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
      chunks.push(typeof data === "object" && data !== null ? JSON.stringify(data) : String(data ?? ""));
      flush();
    },
    json(data)       { hdrs["content-type"] = "application/json"; chunks.push(JSON.stringify(data)); flush(); },
    status(s)        { status = s; return this; },
    type(t)          { hdrs["content-type"] = t; return this; },
    set(k, v)        { hdrs[k.toLowerCase()] = String(v); return this; },
    get(k)           { return hdrs[k.toLowerCase()]; },
    redirect(s, u)   { if (typeof s === "string") { u = s; s = 302; } status = s; hdrs["location"] = u; flush(); },
    on() { return this; }, emit() { return this; }, once() { return this; }, removeListener() { return this; },
  };
}

// ── Workers fetch handler ─────────────────────────────────────────
export default {
  async fetch(request, env) {
    injectEnv(env);
    try {
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
        const wrap  = (fn) => (...a) => { clearTimeout(timer); fn(...a); };
        res.end  = wrap(res.end.bind(res));
        res.send = wrap(res.send.bind(res));
        res.json = wrap(res.json.bind(res));
        try {
          app(req, res, (err) => {
            clearTimeout(timer);
            resolve(new Response(
              JSON.stringify({ error: err ? err.message : "Not Found" }),
              { status: err ? 500 : 404, headers: { "content-type": "application/json" } }
            ));
          });
        } catch (err) { clearTimeout(timer); reject(err); }
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
