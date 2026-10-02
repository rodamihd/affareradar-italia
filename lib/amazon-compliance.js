const APPROVED_PRICE_SOURCES = new Set([
  "creators_api",
  "pa_api",
  "amazon_link_tool",
  "sitestripe",
  "mobile_getlink"
]);

export function amazonPriceDisplayAllowed(body = {}) {
  const source = String(body.priceSource || body.amazonDataSource || "").trim().toLowerCase();
  return body.priceVerifiedByAmazon === true || APPROVED_PRICE_SOURCES.has(source);
}

export function amazonPromotionDisplayAllowed(body = {}, now = Date.now()) {
  if (body.promotionVerifiedByAmazon !== true && body.couponVerifiedByAmazon !== true) return false;
  if (!body.promotionValidUntil) return true;
  const ts = Date.parse(body.promotionValidUntil);
  return Number.isFinite(ts) && ts >= now;
}

export function sanitizeForAmazonPublication(body = {}, now = Date.now()) {
  const priceAllowed = amazonPriceDisplayAllowed(body);
  const promotionAllowed = amazonPromotionDisplayAllowed(body, now);
  const sanitized = { ...body };

  if (!priceAllowed) {
    sanitized.price = null;
    sanitized.oldPrice = null;
    sanitized.effectivePrice = null;
    sanitized.discount = null;
    sanitized.historicalLow = false;
    sanitized.suppressPriceDisplay = true;
    if (sanitized.dealType === "price_error") sanitized.dealType = "deal";
  }

  if (!promotionAllowed) {
    sanitized.coupon = null;
    sanitized.stack = null;
    if (sanitized.dealType === "coupon_stack") sanitized.dealType = "deal";
  }

  if (!priceAllowed || !promotionAllowed) {
    sanitized.publicationCompliance = {
      priceDisplayAllowed:priceAllowed,
      promotionDisplayAllowed:promotionAllowed,
      sanitized:true
    };
  }

  return {
    body:sanitized,
    priceDisplayAllowed:priceAllowed,
    promotionDisplayAllowed:promotionAllowed,
    sanitized:!priceAllowed || !promotionAllowed
  };
}

export function amazonAgentUserAgent(agentName = "AffareRadar") {
  const clean = String(agentName || "AffareRadar").replace(/[^A-Za-z0-9._-]/g, "");
  return `Agent/${clean || "AffareRadar"}`;
}

export const amazonPublicPriceTrackingAllowed = false;
