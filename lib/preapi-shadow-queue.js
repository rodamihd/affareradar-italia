import { buildShadowReview } from "./preapi-shadow-review.js";

// Internal review-only projection. Never returns source prices, tracking links or publish instructions.
export function buildShadowReviewQueue(signals = [], now = new Date(), limit = 12) {
  const count = Number.isInteger(limit) ? Math.max(0, Math.min(limit, 50)) : 12;
  const reviews = [];
  const seen = new Set();
  for (const signal of count > 0 && Array.isArray(signals) ? signals.slice(0, 250) : []) {
    const review = buildShadowReview(signal, now);
    const key = review.productUrl || `invalid:${reviews.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reviews.push(review);
    if (reviews.length >= count) break;
  }
  return {
    schemaVersion: 1,
    mode: "SHADOW_ONLY",
    decision: "HOLD",
    publicationEnabled: false,
    records: reviews
  };
}
