import crypto from "node:crypto";

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function buildRequestContext(req, identity = {}) {
  const tenantId = clean(identity.tenantId || req.headers["x-fantaos-tenant"]);
  const userId = clean(identity.userId || req.headers["x-fantaos-user"]);
  const leagueId = clean(req.headers["x-fantaos-league"]);
  const incomingRequestId = clean(req.headers["x-request-id"]);

  return Object.freeze({
    tenantId,
    userId,
    leagueId,
    requestId: incomingRequestId || crypto.randomUUID()
  });
}

export function requireIdentity(context) {
  if (!context?.tenantId || !context?.userId) {
    const error = new Error("Authenticated tenant context required");
    error.code = "FANTAOS_AUTH_REQUIRED";
    error.status = 401;
    throw error;
  }

  return context;
}
