"use strict";
const noop = () => (req, res, next) => next();
noop.rateLimit = noop;
module.exports = noop;
