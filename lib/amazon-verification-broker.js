const VERIFIED_SOURCES = new Set(["creators_api","pa_api","sitestripe","amazon_link_tool","mobile_getlink"]);

function normalizeSource(body = {}) {
  return String(body.amazonDataSource || body.priceSource || body.source || "").trim().toLowerCase();
}

export function evaluateAmazonVerification(body = {}, now = Date.now()) {
  const source = normalizeSource(body);
  const amazonVerified = VERIFIED_SOURCES.has(source) || body.priceVerifiedByAmazon === true;
  const verifiedAtRaw = body.lastVerifiedAt || body.verifiedAt || body.verificationTime || null;
  const verifiedAt = verifiedAtRaw ? Date.parse(verifiedAtRaw) : null;
  const ageMinutes = Number.isFinite(verifiedAt) ? Math.max(0, (now - verifiedAt) / 60000) : null;
  const maxAgeMinutes = Number(process.env.AMAZON_VERIFICATION_MAX_AGE_MINUTES || 10);
  const fresh = ageMinutes != null ? ageMinutes <= maxAgeMinutes : false;
  const hasAsin = Boolean(String(body.asin || "").trim());
  const hasAmazonUrl = /(?:^|\.)amazon\.it$/i.test((() => { try { return new URL(body.amazonUrl || "").hostname; } catch { return ""; } })());
  const state = amazonVerified && fresh
    ? "VERIFIED"
    : amazonVerified
      ? "STALE"
      : "SIGNAL_ONLY";

  return {
    state,
    source:source || null,
    amazonVerified,
    fresh,
    verifiedAt: Number.isFinite(verifiedAt) ? new Date(verifiedAt).toISOString() : null,
    ageMinutes:ageMinutes == null ? null : Number(ageMinutes.toFixed(1)),
    maxAgeMinutes,
    hasAsin,
    hasAmazonUrl,
    publishableCommercialData:state === "VERIFIED",
    needsAmazonVerification:state !== "VERIFIED"
  };
}

export function mergeVerifiedAmazonData(signal = {}, verified = {}) {
  const signalClaims = signal.signalClaims && typeof signal.signalClaims === "object"
    ? {
        ...signal.signalClaims,
        state:"VERIFIED",
        verifiedAt:verified.lastVerifiedAt || verified.verifiedAt || new Date().toISOString(),
        verifiedBy:verified.amazonDataSource || verified.priceSource || "verified_amazon_source",
        comparison:{
          claimedPrice:signal.signalClaims.claims?.effectivePrice || signal.signalClaims.claims?.price || null,
          verifiedPrice:verified.effectivePrice || verified.price || null,
          claimedDiscount:signal.signalClaims.claims?.discount || null,
          verifiedDiscount:verified.discount || null
        }
      }
    : null;

  return {
    ...signal,
    ...verified,
    source:signal.source || verified.source || null,
    signalSource:signal.source || null,
    signalClaims,
    requiresAmazonVerification:false,
    quarantineState:signalClaims ? "VERIFIED" : (signal.quarantineState || null),
    amazonDataSource:verified.amazonDataSource || verified.priceSource || "verified_amazon_source",
    verificationBrokerMerged:true
  };
}
