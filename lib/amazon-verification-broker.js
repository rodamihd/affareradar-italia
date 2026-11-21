import { verifyAmazonApiAttestation } from "./amazon-verification-attestation.js";
// Verification is fail-closed for automatic publication.

function normalizeSource(body = {}) {
  return String(body.amazonDataSource || body.priceSource || body.source || "").trim().toLowerCase();
}

export function evaluateAmazonVerification(body = {}, now = Date.now()) {
  const source = normalizeSource(body);
  // A caller-supplied boolean is not evidence of Amazon provenance.
  // Manual Amazon tools require a separately attested human review before publication.
  const amazonVerified = (source === "creators_api" || source === "pa_api") && verifyAmazonApiAttestation(body);
  const verifiedAtRaw = body.lastVerifiedAt || body.verifiedAt || body.verificationTime || null;
  const verifiedAt = verifiedAtRaw ? Date.parse(verifiedAtRaw) : null;
  const ageMinutes = Number.isFinite(verifiedAt) ? (now - verifiedAt) / 60000 : null;
  const maxAgeMinutes = Number(process.env.AMAZON_VERIFICATION_MAX_AGE_MINUTES || 10);
  const fresh = ageMinutes != null && ageMinutes >= 0 && Number.isFinite(maxAgeMinutes) && maxAgeMinutes > 0 && ageMinutes <= maxAgeMinutes;
  const hasAsin = Boolean(String(body.asin || "").trim());
  const parsedUrl = (() => { try { return new URL(body.amazonUrl || ""); } catch { return null; } })();
  const hasAmazonUrl = parsedUrl?.protocol === "https:" && /(?:^|\.)amazon\.it$/i.test(parsedUrl.hostname);
  const urlAsin = parsedUrl?.pathname.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]?.toUpperCase() || null;
  const asinMatchesUrl = Boolean(hasAsin && urlAsin && String(body.asin).toUpperCase() === urlAsin);
  const rawPrice = body.effectivePrice ?? body.price;
  const priceText = String(rawPrice ?? "").replace(/[^0-9,.-]/g, "");
  const normalizedPrice = priceText.includes(",") ? priceText.replace(/\./g, "").replace(",", ".") : priceText;
  const currentPrice = normalizedPrice ? Number(normalizedPrice) : NaN;
  const hasPositivePrice = Number.isFinite(currentPrice) && currentPrice > 0;
  const state = amazonVerified && fresh && hasAmazonUrl && asinMatchesUrl && hasPositivePrice
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
    asinMatchesUrl,
    hasPositivePrice,
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
