import crypto from "node:crypto";

// Signature authenticates a server-produced API result; it does not independently prove
// the API payload's truth. Keep this secret distinct from PUBLISH_SECRET.
function signingPayload(body) {
  return JSON.stringify([
    String(body.asin || "").toUpperCase(),
    String(body.amazonUrl || ""),
    String(body.effectivePrice ?? body.price ?? ""),
    String(body.lastVerifiedAt || ""),
    String(body.amazonDataSource || body.priceSource || ""),
    String(body.oldPrice ?? ""),
    String(body.discount ?? ""),
    String(body.coupon ?? ""),
    String(body.stack ?? ""),
    String(body.historicalLow === true)
  ]);
}
function signingKey() {
  const secret = process.env.AMAZON_VERIFICATION_ATTESTATION_SECRET;
  const publisher = process.env.PUBLISH_SECRET;
  if (!secret || secret.length < 32 || secret === publisher) return null;
  return secret;
}
export function attestAmazonApiResult(body = {}) {
  const key = signingKey();
  const source = String(body.amazonDataSource || body.priceSource || "");
  if (!key || !["creators_api", "pa_api"].includes(source)) return null;
  const mac = crypto.createHmac("sha256", key).update(signingPayload(body)).digest("hex");
  return { version:1, mac };
}
export function verifyAmazonApiAttestation(body = {}) {
  const key = signingKey();
  const attestation = body.amazonVerificationAttestation;
  if (!key || attestation?.version !== 1 || !/^[0-9a-f]{64}$/.test(String(attestation.mac || ""))) return false;
  const expected = crypto.createHmac("sha256", key).update(signingPayload(body)).digest();
  const supplied = Buffer.from(attestation.mac, "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
