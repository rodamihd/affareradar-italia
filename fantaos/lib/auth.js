import crypto from "node:crypto";

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(encodedPayload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

export function createSessionToken(claims, options = {}) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    const error = new Error("AUTH_SECRET is not configured");
    error.code = "FANTAOS_AUTH_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }

  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = Number(options.ttlSeconds || 3600);
  const payload = {
    sub: claims.userId,
    tenant_id: claims.tenantId,
    email: claims.email || null,
    iat: now,
    exp: now + ttlSeconds
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = signPayload(encoded, secret);
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    const error = new Error("AUTH_SECRET is not configured");
    error.code = "FANTAOS_AUTH_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }

  if (!token || typeof token !== "string" || !token.includes(".")) {
    const error = new Error("Invalid session token");
    error.code = "FANTAOS_AUTH_REQUIRED";
    error.status = 401;
    throw error;
  }

  const [encoded, signature] = token.split(".");
  const expected = signPayload(encoded, secret);
  const valid =
    signature &&
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  if (!valid) {
    const error = new Error("Invalid session token");
    error.code = "FANTAOS_AUTH_INVALID";
    error.status = 401;
    throw error;
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) {
    const error = new Error("Session token expired");
    error.code = "FANTAOS_AUTH_EXPIRED";
    error.status = 401;
    throw error;
  }

  return payload;
}

export function identityFromRequest(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  const payload = verifySessionToken(match?.[1]);

  return {
    userId: payload.sub,
    tenantId: payload.tenant_id,
    email: payload.email || null
  };
}
