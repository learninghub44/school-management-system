"use strict";
// Stub: Workers doesn't need iconv-lite charset conversion
module.exports = {
  decode: (buf, enc) => (Buffer.isBuffer(buf) ? buf : Buffer.from(buf)).toString("utf8"),
  encode: (str) => Buffer.from(String(str), "utf8"),
  encodingExists: () => true,
  getDecoder: () => ({ write: (b) => b.toString("utf8"), end: () => "" }),
  getEncoder: () => ({ write: (s) => Buffer.from(s), end: () => Buffer.alloc(0) }),
};
