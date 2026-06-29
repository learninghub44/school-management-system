"use strict";
/**
 * body-parser stub for Cloudflare Workers.
 * The worker shim (worker-entry.js) attaches the parsed body to req._workerBody
 * before calling the Express app. This stub reads from there instead of
 * attempting to use Node.js streams (which Workers doesn't support).
 */

function jsonParser(opts) {
  return function(req, res, next) {
    if (req._workerBody !== undefined) {
      req.body = req._workerBody;
      return next();
    }
    // Collect from stream shim
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!chunks.length) return next();
      try {
        const raw = Buffer.concat(chunks.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c)));
        const ct  = (req.headers["content-type"] || "").split(";")[0].trim();
        if (ct === "application/json" || ct === "") {
          req.body = JSON.parse(raw.toString("utf8"));
        } else {
          req.body = {};
        }
      } catch (e) {
        req.body = {};
      }
      next();
    });
  };
}

function urlencodedParser(opts) {
  return function(req, res, next) {
    if (req._workerBody !== undefined) {
      req.body = req._workerBody;
      return next();
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!chunks.length) return next();
      try {
        const raw = Buffer.concat(chunks.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c)));
        req.body = Object.fromEntries(new URLSearchParams(raw.toString("utf8")));
      } catch (e) {
        req.body = {};
      }
      next();
    });
  };
}

function rawParser(opts) {
  return (req, res, next) => next();
}
function textParser(opts) {
  return (req, res, next) => next();
}

const bodyParser = { json: jsonParser, urlencoded: urlencodedParser, raw: rawParser, text: textParser };
module.exports = bodyParser;
module.exports.json = jsonParser;
module.exports.urlencoded = urlencodedParser;
module.exports.raw = rawParser;
module.exports.text = textParser;
