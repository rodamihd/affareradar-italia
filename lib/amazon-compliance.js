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
  if (body.promotionTimeLimited === true && !body.promotionValidUntil) return false;
  if (!body.promotionValidUntil) return true;
  const ts = Date.parse(body.promotionValidUntil);
  return Number.isFinite(ts) && ts >= now;
}

function stripUnverifiedCommercialClaims(value = "") {
  return String(value || "")
    .replace(/(?:EUR|€)\s*\d{1,5}(?:[.,]\d{1,2})?/gi, "")
    .replace(/\d{1,5}(?:[.,]\d{1,2})?\s*(?:EUR|€)/gi, "")
    .replace(/(?:-|−)?\s*\d{1,3}\s*%/g, "")
    .replace(/\b(?:minimo storico|prezzo minimo|price error|errore(?: di)? prezzo|coupon|codice sconto|stack promo)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function sanitizeForAmazonPublication(body = {}, now = Date.now()) {
  if (body.rewardProgram || body.program) {
    return {
      body:{ ...body },
      priceDisplayAllowed:true,
      promotionDisplayAllowed:true,
      sanitized:false,
      rewardHandledSeparately:true
    };
  }

  const isolated = applyAmazonDataIsolation(body);
  const priceAllowed = amazonPriceDisplayAllowed(isolated);
  const promotionAllowed = amazonPromotionDisplayAllowed(isolated, now);
  const imageProvenance = evaluateImageProvenance(isolated);
  const productEligibility = evaluateProductEligibility(isolated);
  const sanitized = { ...isolated };

  if (!priceAllowed) {
    sanitized.price = null;
    sanitized.oldPrice = null;
    sanitized.effectivePrice = null;
    sanitized.discount = null;
    sanitized.historicalLow = false;
    sanitized.suppressPriceDisplay = true;
    sanitized.title = stripUnverifiedCommercialClaims(sanitized.title);
    sanitized.reason = stripUnverifiedCommercialClaims(sanitized.reason);
    if (sanitized.dealType === "price_error") sanitized.dealType = "deal";
  }

  if (!promotionAllowed) {
    sanitized.coupon = null;
    sanitized.stack = null;
    sanitized.title = stripUnverifiedCommercialClaims(sanitized.title);
    sanitized.reason = stripUnverifiedCommercialClaims(sanitized.reason);
    if (sanitized.dealType === "coupon_stack") sanitized.dealType = "deal";
  }

  if (!imageProvenance.passed) {
    sanitized.imageUrl = null;
    sanitized.imageSuppressed = true;
  }

  if (!priceAllowed || !promotionAllowed || !imageProvenance.passed) {
    sanitized.publicationCompliance = {
      priceDisplayAllowed:priceAllowed,
      promotionDisplayAllowed:promotionAllowed,
      imageProvenance,
      productEligibility,
      sanitized:true
    };
  }

  return {
    body:sanitized,
    priceDisplayAllowed:priceAllowed,
    promotionDisplayAllowed:promotionAllowed,
    imageProvenance,
    productEligibility,
    sanitized:!priceAllowed || !promotionAllowed || !imageProvenance.passed
  };
}

export function amazonAgentUserAgent(agentName = "AffareRadar") {
  const clean = String(agentName || "AffareRadar").replace(/[^A-Za-z0-9._-]/g, "");
  return `Agente/${clean || "AffareRadar"}`;
}

export const amazonPublicPriceTrackingAllowed = false;


const EXCLUDED_PRODUCT_PATTERNS = [
  /\blatte artificiale\b/i,
  /\binfant formula\b/i,
  /\bbevanda alcolica\b/i,
  /\balcolic[oi]\b/i,
  /\bbirra\b/i,
  /\bvino\b/i,
  /\bwhisk(?:y|ey)\b/i,
  /\bvodka\b/i,
  /\brum\b/i,
  /\btabacco\b/i,
  /\bsigarett[ae]\b/i,
  /\be-?cig(?:arette)?\b/i,
  /\bsigaretta elettronica\b/i,
  /\bvape\b/i
];

export function evaluateProductEligibility(body = {}) {
  if (body.productEligibleByAmazon === true) {
    return { passed:true, status:"AMAZON_VERIFIED_ELIGIBLE", reason:null };
  }
  if (body.productExcludedByAmazon === true) {
    return { passed:false, status:"EXCLUDED", reason:"amazon_marked_excluded" };
  }

  const text = [
    body.title,
    body.category,
    body.reason,
    body.productType,
    body.browseNodeName
  ].filter(Boolean).join(" ");

  const match = EXCLUDED_PRODUCT_PATTERNS.find(rx => rx.test(text));
  return {
    passed:!match,
    status:match ? "POTENTIALLY_EXCLUDED" : "NO_EXCLUSION_SIGNAL",
    reason:match ? "excluded_product_pattern" : null
  };
}

export function evaluateImageProvenance(body = {}) {
  if (!body.imageUrl) {
    return { passed:true, status:"NO_IMAGE", publishImage:false };
  }

  const source = String(body.imageSource || body.amazonDataSource || "").trim().toLowerCase();
  const amazonAuthorized =
    body.imageVerifiedByAmazon === true ||
    source === "creators_api" ||
    source === "pa_api" ||
    source === "amazon_link_tool" ||
    source === "sitestripe";
  const ownedOrLicensed =
    body.imageOwned === true ||
    body.imageLicensed === true ||
    source === "owned" ||
    source === "licensed";

  const passed = amazonAuthorized || ownedOrLicensed;
  return {
    passed,
    status:amazonAuthorized ? "AMAZON_AUTHORIZED" : ownedOrLicensed ? "OWNED_OR_LICENSED" : "UNKNOWN",
    publishImage:passed
  };
}

export function applyAmazonDataIsolation(body = {}) {
  const programContent =
    body.amazonProgramContent === true ||
    ["creators_api","pa_api"].includes(String(body.amazonDataSource || body.priceSource || "").toLowerCase());

  return {
    ...body,
    amazonProgramContent:programContent,
    aiTrainingAllowed:programContent ? false : body.aiTrainingAllowed !== false,
    programContentCacheTTLSeconds:programContent ? 82800 : null,
    dataUsagePolicy:programContent ? "OPERATIONAL_ONLY_NO_TRAINING" : (body.dataUsagePolicy || "STANDARD")
  };
}
