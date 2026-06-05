/**
 * validateUUID — express middleware that validates UUID route params
 * Usage: router.get("/:id", validateUUID("id"), ...)
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUUID(...paramNames) {
  return (req, res, next) => {
    for (const param of paramNames) {
      const val = req.params[param];
      if (val && !UUID_RE.test(val)) {
        return res.status(400).json({ success: false, message: `Invalid ID format: ${param}` });
      }
    }
    next();
  };
}

module.exports = validateUUID;
