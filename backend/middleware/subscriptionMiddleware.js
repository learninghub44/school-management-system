/**
 * Subscription middleware — BYPASSED
 * Payment is handled manually by Super Admin (school activation on agreement).
 * Re-enable when official payment gateway is onboarded.
 */
"use strict";

async function requireSubscription(req, res, next) {
  return next();
}

function subCacheBust() {}

module.exports = requireSubscription;
module.exports.subCacheBust = subCacheBust;
