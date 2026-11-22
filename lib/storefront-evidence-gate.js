import crypto from "node:crypto";

// This binds a public offer to a separate server-side review record.
// It proves equality with the stored record, NOT authenticity of a licensed feed.
// The writer of the review key must be a separate, human-approved trusted service.
const REF = /^[a-zA-Z0-9:_-]{8,120}$/;
const ID = /^[a-zA-Z0-9:_-]{3,80}$/;
const HEX = /^[a-f0-9]{64}$/;

export function storefrontEvidenceKey(ref) {
  if (typeof ref !== "string" || !REF.test(ref)) return null;
  return `affareradar:storefront:review:v1:${ref}`;
}

export function offerEvidenceDigest(offer) {
  if (!offer || typeof offer !== "object") return null;
  const payload = [
    "affareradar:offer:v1",
    offer.url,
    offer.title,
    offer.merchant,
    offer.price_eur,
    offer.price_source,
    offer.verified_at,
    offer.expires_at,
    offer.review_reference
  ];
  return crypto.createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

export function validateStoredReview(offer, review, now = Date.now()) {
  if (!offer || !review || typeof review !== "object" || Array.isArray(review)) {
    return { ok:false, reason:"trusted_review_missing" };
  }
  const key = storefrontEvidenceKey(offer.review_reference);
  if (!key || review.review_reference !== offer.review_reference ||
      review.schema_version !== 1 || review.decision !== "APPROVED" ||
      review.marketplace !== "IT") return { ok:false, reason:"trusted_review_mismatch" };

  const digest = offerEvidenceDigest(offer);
  if (typeof review.offer_digest !== "string" || !HEX.test(review.offer_digest) ||
      review.offer_digest !== digest) return { ok:false, reason:"trusted_review_digest_mismatch" };

  if (!ID.test(review.provider_reviewer_id || "") || !ID.test(review.editorial_reviewer_id || "") ||
      review.provider_reviewer_id === review.editorial_reviewer_id) {
    return { ok:false, reason:"independent_reviewers_required" };
  }
  if (review.licensed_display_reviewed !== true || review.price_source_reviewed !== true ||
      review.shipping_checked !== true || review.stock_checked !== true ||
      review.stock_status !== "IN_STOCK") {
    return { ok:false, reason:"review_evidence_incomplete" };
  }
  if (typeof review.license_reference !== "string" || !ID.test(review.license_reference) ||
      typeof review.source_evidence_reference !== "string" ||
      !ID.test(review.source_evidence_reference)) {
    return { ok:false, reason:"source_or_license_reference_missing" };
  }
  const reviewedAt = Date.parse(review.reviewed_at || "");
  const verifiedAt = Date.parse(offer.verified_at || "");
  if (!Number.isFinite(reviewedAt) || !Number.isFinite(verifiedAt) ||
      reviewedAt < verifiedAt || reviewedAt > now || now - reviewedAt > 10 * 60000) {
    return { ok:false, reason:"trusted_review_stale" };
  }
  return { ok:true, reason:"stored_review_fields_match" };
}
