import { redisCommand, redisConfig } from "./redis-rest.js";
import { validateApprovedOffer } from "./public-offer-validation.js";

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
  if (!redisConfig()) return res.status(503).json({ ok:false, error:"storefront_unavailable" });

  if (req.method === "POST") {
    const checked = validateApprovedOffer(req.body?.offer);
    if (!checked.ok) return res.status(422).json({ ok:false, error:checked.reason });
    try {
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
