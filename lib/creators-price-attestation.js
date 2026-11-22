import crypto from "node:crypto";
import { offerEvidenceDigest, storefrontEvidenceKey } from "./storefront-evidence-gate.js";

// Only an approved upstream verifier, operating outside this deployment, may
// hold the private signing key. This module does NOT call Creators API.
// A valid signature attests the verifier's claim, NOT Amazon's actual response.
const FIELDS = Object.freeze([
  "schema_version","issuer","source","marketplace","asin",
  "offer_digest","currency","price_cents","availability",
  "observed_at","retrieval_reference","license_review_reference"
]);
const IDENTIFIER = /^[a-zA-Z0-9:_-]{8,120}$/;
const ASIN = /^[A-Z0-9]{10}$/;
const AGE_MS = 10 * 60 * 1000;
const ISSUER = "affareradar_creators_verifier_it_v1";
const SOURCE = "amazon_creators_api_getitems_offersv2";

export function storefrontPriceProofKey(reference) {
  if (!storefrontEvidenceKey(reference)) return null;
  return `affareradar:storefront:price-proof:v1:${reference}`;
}

export function canonicalPriceAttestation(claims) {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
  return Buffer.from(JSON.stringify(FIELDS.map(k => claims[k] ?? null)), "utf8");
}

export function validatePriceAttestation(offer, record, publicKeyPem, now = Date.now()) {
  if (!offer || offer.price_source !== "creators_api") return { ok:false, reason:"creators_source_required" };
  if (!storefrontPriceProofKey(offer.review_reference)) return { ok:false, reason:"invalid_price_proof_reference" };
  if (!publicKeyPem || typeof publicKeyPem !== "string") return { ok:false, reason:"price_proof_key_not_configured" };
  if (!record || typeof record !== "object" || Array.isArray(record) ||
      record.schema_version !== 1 || !record.claims || typeof record.signature !== "string") {
    return { ok:false, reason:"signed_price_proof_missing" };
  }

  const c = record.claims;
  const digest = offerEvidenceDigest(offer);
  const url = (() => { try { return new URL(offer.url); } catch { return null; } })();
  const asin = url?.pathname.match(/^\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
  const cents = Math.round(Number(offer.price_eur) * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(Number(offer.price_eur) * 100 - cents) > 0.0000001 ||
      !ASIN.test(asin || "") || c.schema_version !== 1 || c.issuer !== ISSUER ||
      c.source !== SOURCE || c.marketplace !== "www.amazon.it" ||
      c.asin !== asin || c.offer_digest !== digest ||
      c.currency !== "EUR" || c.price_cents !== cents ||
      c.availability !== "IN_STOCK" ||
      !IDENTIFIER.test(c.retrieval_reference || "") ||
      !IDENTIFIER.test(c.license_review_reference || "")) {
    return { ok:false, reason:"price_proof_claim_mismatch" };
  }

  const ts = Date.parse(c.observed_at || "");
  const offerTs = Date.parse(offer.verified_at || "");
  if (!Number.isFinite(ts) || !Number.isFinite(offerTs) ||
      ts !== offerTs || ts > now || now - ts > AGE_MS) {
    return { ok:false, reason:"price_proof_stale" };
  }
  if (!/^[a-zA-Z0-9_-]{86}$/.test(record.signature)) {
    return { ok:false, reason:"price_proof_signature_invalid" };
  }
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") return { ok:false, reason:"price_proof_key_invalid" };
    const signature = Buffer.from(record.signature, "base64url");
    const data = canonicalPriceAttestation(c);
    if (!data || signature.length !== 64 || !crypto.verify(null, data, key, signature)) {
      return { ok:false, reason:"price_proof_signature_invalid" };
    }
  } catch {
    return { ok:false, reason:"price_proof_signature_invalid" };
  }
  return { ok:true, reason:"signed_claims_verified_not_live_provider_verified" };
}
