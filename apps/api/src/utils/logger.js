// Emits structured, privacy-safe operational events for local and CloudWatch logs.
const crypto = require("crypto");

function hashUserId(userId) {
  if (!userId) return null;
  return crypto.createHash("sha256").update(userId).digest("hex").slice(0, 16);
}

function logEvent(level, event, fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields
  };

  const output = JSON.stringify(entry);
  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
}

function auditMiddleware(req, res, next) {
  const startedAt = Date.now();
  req.requestId = req.headers["x-request-id"] || crypto.randomUUID();
  res.setHeader("x-request-id", req.requestId);

  res.on("finish", () => {
    const shouldAudit = req.method !== "GET" || res.statusCode >= 400;
    if (!shouldAudit) return;

    logEvent(res.statusCode >= 500 ? "error" : "info", "api_request_completed", {
      requestId: req.requestId,
      userIdHash: hashUserId(req.user?.sub),
      method: req.method,
      route: req.route?.path || "unmatched",
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });

  next();
}

module.exports = { auditMiddleware, hashUserId, logEvent };
