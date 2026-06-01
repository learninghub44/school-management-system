/**
 * Input sanitization middleware — V-09, V-13
 * Strips HTML/script tags from all string fields in req.body
 * Uses sanitize-html with zero-trust config (no tags allowed)
 */
const sanitizeHtml = require("sanitize-html");

// Strip ALL HTML tags — names/comments/etc should be plain text only
function cleanValue(val) {
    if (typeof val !== "string") return val;
    return sanitizeHtml(val, { allowedTags: [], allowedAttributes: {} }).trim();
}

function deepClean(obj) {
    if (typeof obj !== "object" || obj === null) return cleanValue(obj);
    if (Array.isArray(obj)) return obj.map(deepClean);
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
        clean[k] = deepClean(v);
    }
    return clean;
}

const sanitizeBody = (req, res, next) => {
    if (req.body && typeof req.body === "object") {
        req.body = deepClean(req.body);
    }
    next();
};

module.exports = { sanitizeBody, cleanValue };
