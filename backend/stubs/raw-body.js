"use strict";
// Stub: raw-body reads Node.js streams — not needed since worker shim handles body
module.exports = function getRawBody(stream, opts, cb) {
  const chunks = [];
  stream.on("data", (c) => chunks.push(c));
  stream.on("end", () => {
    const buf = Buffer.concat(chunks.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c)));
    if (typeof opts === "function") { opts(null, buf); return; }
    if (typeof cb === "function")   { cb(null, buf); return; }
  });
  stream.on("error", (e) => {
    if (typeof opts === "function") opts(e);
    else if (typeof cb === "function") cb(e);
  });
};
