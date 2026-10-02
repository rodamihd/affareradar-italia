import crypto from "node:crypto";

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24);
}

export function extractAsinFromAmazonUrl(value = "") {
  try {
    const u = new URL(value);
    const patterns = [
      /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
      /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
      /\/product\/([A-Z0-9]{10})(?:[/?]|$)/i
    ];
    for (const pattern of patterns) {
      const match = u.pathname.match(pattern);
      if (match) return match[1].toUpperCase();
    }
  } catch {}
  return null;
}

export function buildSignalQuarantine(body = {}, now = Date.now()) {
  const observedAt = body.lastVerifiedAt || body.publishedAt || body.signalObservedAt || new Date(now).toISOString();
  const asinCandidate = String(body.asin || extractAsinFromAmazonUrl(body.amazonUrl || "") || "").toUpperCase() || null;
  const claims = {
    price:body.price || null,
    oldPrice:body.oldPrice || null,
    effectivePrice:body.effectivePrice || body.price || null,
    discount:body.discount || null,
    coupon:body.coupon || null,
    stack:body.stack || null,
    dealType:body.dealType || null,
    historicalLow:body.historicalLow === true
  };
  const commercialClaimPresent = Boolean(
    claims.price || claims.oldPrice || claims.effectivePrice || claims.discount ||
    claims.coupon || claims.stack || claims.historicalLow || claims.dealType === "price_error"
  );
  const quarantineId = `sq_${hash(`${body.source || "unknown"}|${asinCandidate || body.amazonUrl || body.title || "unknown"}|${observedAt}`)}`;

  return {
    version:"2.0",
    quarantineId,
    state:"PARSED",
    source:body.source || null,
    sourceObservedAt:observedAt,
    capturedAt:new Date(now).toISOString(),
    asinCandidate,
    amazonUrl:body.amazonUrl || null,
    commercialClaimPresent,
    requiresAmazonVerification:commercialClaimPresent,
    claims
  };
}

export function needsQuarantineVerification(body = {}, verification = {}) {
  return Boolean(
    body.signalClaims &&
    body.signalClaims.requiresAmazonVerification === true &&
    verification?.state !== "VERIFIED"
  );
}
