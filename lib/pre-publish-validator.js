function parseTimestamp(value) {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

export function validateAmazonUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    return host === "amazon.it" ||
      host.endsWith(".amazon.it") ||
      host === "amzn.eu" ||
      host === "primevideo.com" ||
      host === "www.primevideo.com" ||
      host === "link.amazon";
  } catch {
    return false;
  }
}

function pushFailure(failures, code, field, detail = null) {
  failures.push({ code, field, detail });
}

function pushWarning(warnings, code, field, detail = null) {
  warnings.push({ code, field, detail });
}

export function prePublishValidate(body = {}, now = Date.now(), options = {}) {
  const mode = String(options.mode || process.env.REVALIDATION_MODE || "soft").toLowerCase();
  const maxAgeMinutes = Number(
    options.maxAgeMinutes ||
    process.env.REVALIDATION_MAX_AGE_MINUTES ||
    10
  );
  const maxAgeMs = Math.max(1, maxAgeMinutes) * 60 * 1000;
  const verifiedAtRaw = body.lastVerifiedAt || body.verifiedAt || body.verificationTime;
  const verifiedAt = parseTimestamp(verifiedAtRaw);

  const failures = [];
  const warnings = [];

  if (!validateAmazonUrl(body.amazonUrl)) {
    pushFailure(failures, "INVALID_AMAZON_URL", "amazonUrl");
  }

  if (verifiedAt) {
    const age = now - verifiedAt;
    if (age < -60 * 1000) {
      pushFailure(failures, "VERIFICATION_TIMESTAMP_IN_FUTURE", "verifiedAt");
    }
    if (age > maxAgeMs) {
      pushFailure(failures, "STALE_VERIFICATION", "verifiedAt", {
        ageMinutes:Number((age / 60000).toFixed(2)),
        maxAgeMinutes
      });
    }
  } else if (mode === "strict") {
    pushFailure(failures, "MISSING_VERIFICATION_TIMESTAMP", "verifiedAt");
  } else {
    pushWarning(warnings, "MISSING_VERIFICATION_TIMESTAMP", "verifiedAt");
  }

  if (body.priceVerified === false) {
    pushFailure(failures, "PRICE_NOT_VERIFIED", "priceVerified");
  } else if (body.priceVerified !== true) {
    if (mode === "strict") {
      pushFailure(failures, "MISSING_PRICE_VERIFICATION", "priceVerified");
    } else {
      pushWarning(warnings, "MISSING_PRICE_VERIFICATION", "priceVerified");
    }
  }

  const hasCoupon = Boolean(
    body.coupon ||
    body.stack ||
    String(body.dealType || "").toLowerCase() === "coupon_stack"
  );

  if (hasCoupon) {
    if (body.couponVerified === false) {
      pushFailure(failures, "COUPON_NOT_VERIFIED", "couponVerified");
    } else if (body.couponVerified !== true) {
      if (mode === "strict") {
        pushFailure(failures, "MISSING_COUPON_VERIFICATION", "couponVerified");
      } else {
        pushWarning(warnings, "MISSING_COUPON_VERIFICATION", "couponVerified");
      }
    }
  }

  if (body.stock === false || String(body.stock).toLowerCase() === "out_of_stock") {
    pushFailure(failures, "OUT_OF_STOCK", "stock");
  }

  if (body.promotionTimeLimited === true && body.promotionValidUntil) {
    const expiry = parseTimestamp(body.promotionValidUntil);
    if (expiry && expiry < now) {
      pushFailure(failures, "PROMOTION_EXPIRED", "promotionValidUntil");
    }
  }

  const blockingCodes = failures.map(item => item.code);
  const warningCodes = warnings.map(item => item.code);

  return {
    version:"33.10",
    stage:"PRE_PUBLISH",
    passed:failures.length === 0,
    mode,
    checkedAt:new Date(now).toISOString(),
    maxAgeMinutes,
    verifiedAt:verifiedAt ? new Date(verifiedAt).toISOString() : null,
    failures,
    warnings,
    blockingCodes,
    warningCodes,
    action:failures.length ? "BLOCK" : warnings.length ? "ALLOW_WITH_WARNINGS" : "ALLOW"
  };
}

export function rewardPrePublishValidate(body = {}, now = Date.now()) {
  const failures = [];
  const validUrl = validateAmazonUrl(body.amazonUrl);
  if (!validUrl) pushFailure(failures, "INVALID_AMAZON_URL", "amazonUrl");

  if (body.promotionTimeLimited === true && body.promotionValidUntil) {
    const expiry = parseTimestamp(body.promotionValidUntil);
    if (expiry && expiry < now) {
      pushFailure(failures, "PROMOTION_EXPIRED", "promotionValidUntil");
    }
  }

  return {
    version:"33.10",
    stage:"PRE_PUBLISH",
    passed:failures.length === 0,
    mode:"reward",
    checkedAt:new Date(now).toISOString(),
    failures,
    warnings:[],
    blockingCodes:failures.map(item => item.code),
    warningCodes:[],
    action:failures.length ? "BLOCK" : "ALLOW"
  };
}
