import { buildShadowReviewQueue } from "./preapi-shadow-queue.js";

// Restricted internal view model. Never forward raw discovery metadata to UI consumers.
export function projectPreApiDiscoveryForReview(discovery = {}, now = new Date()) {
  const source = Array.isArray(discovery.results) ? discovery.results : [];
  const signals = source.map(item => ({
    asin: item?.quarantine?.asinCandidate || null,
    market: "IT",
    // Deliberately avoid inferring product identity from untrusted fields.
    amazonUrl: null
  }));
  const queue = buildShadowReviewQueue(signals, now, 50);
  return {
    schemaVersion: 1,
    mode: "SHADOW_ONLY",
    decision: "HOLD",
    publicationEnabled: false,
    submitted: queue.records.length,
    records: queue.records
  };
}
