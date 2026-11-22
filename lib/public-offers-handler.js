import { redisCommand, redisConfig } from "./redis-rest.js";
import { validateApprovedOffer } from "./public-offer-validation.js";
import { storefrontEvidenceKey, validateStoredReview } from "./storefront-evidence-gate.js";

const FEED_KEY = "affareradar:storefront:approved:v1";

function noCache(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function authorizedForReview(req) {
  const publish = process.env.PUBLISH_SECRET;
  const approval = process.env.STOREFRONT_APPROVAL_SECRET;
  // Two independent, configured credentials are required; no implicit approval.
  return Boolean(publish && approval && publish !== approval &&
    req.headers["x-affareradar-secret"] === publish &&
    req.headers["x-affareradar-storefront-approval"] === approval);
}

export async function handlePublicOffers(req, res) {
  noCache(res);
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }
  if (req.method === "POST" && !authorizedForReview(req)) {
    return res.status(401).json({ ok:false, error:"approval_credentials_required" });
  }
  // Preview is read-only and never consumes real storefront data from a shared Redis.
  if (process.env.VERCEL_ENV !== "production") {
    if (req.method === "GET") return res.status(200).json({ schema_version:1, offers:[] });
    return res.status(403).json({ ok:false, error:"storefront_preview_write_disabled" });
  }
  if (req.method === "POST" && process.env.AFFARERADAR_STOREFRONT_INGEST_ENABLED !== "true") {
    return res.status(403).json({ ok:false, error:"storefront_ingest_disabled" });
  }
  if (!redisConfig()) return res.status(503).json({ ok:false, error:"storefront_unavailable" });

  if (req.method === "POST") {
    const checked = validateApprovedOffer(req.body?.offer);
    if (!checked.ok) return res.status(422).json({ ok:false, error:checked.reason });
    try {
      const evidenceKey = storefrontEvidenceKey(checked.offer.review_reference);
      const evidenceRaw = await redisCommand("GET", evidenceKey);
      let review;
      try { review = JSON.parse(evidenceRaw.result); } catch { review = null; }
      const evidence = validateStoredReview(checked.offer, review);
      if (!evidence.ok) return res.status(422).json({ ok:false, error:evidence.reason });
      await redisCommand("LPUSH", FEED_KEY, JSON.stringify(checked.offer));
      await redisCommand("LTRIM", FEED_KEY, 0, 99);
      await redisCommand("EXPIRE", FEED_KEY, 86400);
      return res.status(201).json({ ok:true, accepted:true, expires_at:checked.offer.expires_at });
    } catch {
      return res.status(502).json({ ok:false, error:"storefront_write_failed" });
    }
  }

  try {
    const result = await redisCommand("LRANGE", FEED_KEY, 0, 99);
    const raw = Array.isArray(result.result) ? result.result : [];
    const seen = new Set();
    const offers = [];
    for (const entry of raw) {
      let candidate;
      try { candidate = JSON.parse(entry); } catch { continue; }
      const checked = validateApprovedOffer(candidate);
      if (!checked.ok) continue;
      // Re-check the independent trusted record at read time, including revocation.
      const key = storefrontEvidenceKey(checked.offer.review_reference);
      let review;
      try {
        const record = await redisCommand("GET", key);
        review = JSON.parse(record.result);
      } catch { review = null; }
      if (!validateStoredReview(checked.offer, review).ok) continue;
      const product = checked.offer.url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i);
      const identity = product ? product[1].toUpperCase() : checked.offer.url;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const { review_reference, ...publicOffer } = checked.offer;
      offers.push(publicOffer);
      if (offers.length === 6) break;
    }
    return res.status(200).json({ schema_version:1, offers });
  } catch {
    return res.status(503).json({ ok:false, error:"storefront_read_failed" });
  }
}
