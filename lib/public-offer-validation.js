const SOURCES = new Set(["creators_api", "sitestripe", "amazon_link_tool", "mobile_getlink"]);
const MAX_PRICE_AGE_MS = 10 * 60 * 1000;

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}

export function validateApprovedOffer(row, now = Date.now()) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return { ok:false, reason:"invalid_record" };
  if (row.status !== "approved" || row.source_authorized !== true || row.rights_verified !== true) {
    return { ok:false, reason:"approval_or_rights_missing" };
  }
  if (row.price_verified_by_amazon !== true || !SOURCES.has(row.price_source)) {
    return { ok:false, reason:"verified_price_source_required" };
  }
  if (typeof row.review_reference !== "string" || !/^[a-zA-Z0-9:_-]{8,120}$/.test(row.review_reference)) {
    return { ok:false, reason:"review_evidence_required" };
  }
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (title.length < 3 || title.length > 130) return { ok:false, reason:"invalid_title" };
  if (row.merchant !== "Amazon Italia") return { ok:false, reason:"invalid_merchant" };
  if (typeof row.price_eur !== "number" || !Number.isFinite(row.price_eur) ||
      row.price_eur <= 0 || row.price_eur > 100000) {
    return { ok:false, reason:"invalid_price" };
  }

  const verified = timestamp(row.verified_at);
  const expires = timestamp(row.expires_at);
  if (!Number.isFinite(verified) || !Number.isFinite(expires) ||
      verified > now || now - verified > MAX_PRICE_AGE_MS ||
      expires <= now || expires <= verified) {
    return { ok:false, reason:"stale_or_expired" };
  }

  let url;
  try {
    url = new URL(row.url);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !["amazon.it", "www.amazon.it"].includes(url.hostname.toLowerCase()) ||
        !/\/(?:dp|gp\/product)\/[A-Z0-9]{10}(?:\/|$)/i.test(url.pathname)) {
      return { ok:false, reason:"invalid_product_url" };
    }
    url.hash = "";
  } catch {
    return { ok:false, reason:"invalid_product_url" };
  }

  const effectiveExpiry = Math.min(expires, verified + MAX_PRICE_AGE_MS);
  if (effectiveExpiry <= now) return { ok:false, reason:"price_freshness_expired" };
  return {
    ok:true,
    offer:{
      status:"approved",
      source_authorized:true,
      rights_verified:true,
      price_verified_by_amazon:true,
      price_source:row.price_source,
      review_reference:row.review_reference,
      title,
      merchant:"Amazon Italia",
      price_eur:row.price_eur,
      verified_at:new Date(verified).toISOString(),
      expires_at:new Date(effectiveExpiry).toISOString(),
      url:url.href
    }
  };
}
