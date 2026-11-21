import assert from "node:assert/strict";
import { prePublishValidate, rewardPrePublishValidate, publicationRoute } from "./pre-publish-validator.js";

const now = Date.parse("2026-10-04T21:00:00.000Z");

{
  const result = prePublishValidate({
    amazonUrl:"https://www.amazon.it/dp/B012345678",
    verifiedAt:"2026-10-04T20:55:00.000Z",
    priceVerified:true,
    stock:true
  }, now, { mode:"strict", maxAgeMinutes:10 });

  assert.equal(result.passed, true);
  assert.equal(result.action, "ALLOW");
  assert.deepEqual(result.blockingCodes, []);
}

{
  const result = prePublishValidate({
    amazonUrl:"https://www.amazon.it/dp/B012345678",
    verifiedAt:"2026-10-04T20:40:00.000Z",
    priceVerified:true
  }, now, { mode:"strict", maxAgeMinutes:10 });

  assert.equal(result.passed, false);
  assert.equal(result.action, "BLOCK");
  assert.ok(result.blockingCodes.includes("STALE_VERIFICATION"));
}

{
  const result = prePublishValidate({
    amazonUrl:"https://example.com/product",
    verifiedAt:"2026-10-04T20:59:00.000Z",
    priceVerified:false,
    coupon:"20%",
    couponVerified:false,
    stock:"out_of_stock"
  }, now, { mode:"strict", maxAgeMinutes:10 });

  assert.equal(result.passed, false);
  assert.ok(result.blockingCodes.includes("INVALID_AMAZON_URL"));
  assert.ok(result.blockingCodes.includes("PRICE_NOT_VERIFIED"));
  assert.ok(result.blockingCodes.includes("COUPON_NOT_VERIFIED"));
  assert.ok(result.blockingCodes.includes("OUT_OF_STOCK"));
}

{
  const result = prePublishValidate({
    amazonUrl:"https://www.amazon.it/dp/B012345678"
  }, now, { mode:"soft", maxAgeMinutes:10 });

  assert.equal(result.passed, true);
  assert.equal(result.action, "ALLOW_WITH_WARNINGS");
  assert.ok(result.warningCodes.includes("MISSING_VERIFICATION_TIMESTAMP"));
  assert.ok(result.warningCodes.includes("MISSING_PRICE_VERIFICATION"));
}

{
  const result = rewardPrePublishValidate({
    amazonUrl:"https://www.amazon.it/gp/video/offers",
    promotionTimeLimited:true,
    promotionValidUntil:"2026-10-04T20:00:00.000Z"
  }, now);

  assert.equal(result.passed, false);
  assert.ok(result.blockingCodes.includes("PROMOTION_EXPIRED"));
}


{
  const missing = prePublishValidate({
    amazonUrl:"https://www.amazon.it/dp/B012345678",
    stock:true
  }, now, { mode:"strict", maxAgeMinutes:10 });
  assert.equal(missing.passed, false);
  assert.ok(missing.blockingCodes.includes("MISSING_VERIFICATION_TIMESTAMP"));
  assert.ok(missing.blockingCodes.includes("MISSING_PRICE_VERIFICATION"));
}

{
  const missingCouponProof = prePublishValidate({
    amazonUrl:"https://www.amazon.it/dp/B012345678",
    verifiedAt:"2026-10-04T20:59:00.000Z",
    priceVerified:true,
    stock:true,
    coupon:"10%"
  }, now, { mode:"strict", maxAgeMinutes:10 });
  assert.equal(missingCouponProof.passed, false);
  assert.ok(missingCouponProof.blockingCodes.includes("MISSING_COUPON_VERIFICATION"));
}


// Integration-shaped synthetic fixtures: external editorial signals must not gain Amazon price proof.
{
  const externalSignal = prePublishValidate({
    amazonUrl:"https://www.amazon.it/dp/B012345678",
    lastVerifiedAt:"2026-10-04T20:59:00.000Z",
    source:"external_signal",
    sourceVerified:true,
    priceVerifiedByAmazon:false,
    stock:true
  }, now, { mode:"strict", maxAgeMinutes:10 });
  assert.equal(externalSignal.passed, false);
  assert.ok(externalSignal.blockingCodes.includes("MISSING_PRICE_VERIFICATION"));
}

// An asserted human approval for a priceless signal does not bypass the commercial strict gate.
{
  const priceless = prePublishValidate({
    amazonUrl:"https://www.amazon.it/dp/B012345678",
    lastVerifiedAt:"2026-10-04T20:59:00.000Z",
    pricelessSignal:true,
    commercialClaimsSuppressed:true,
    humanApprovedPricelessSignal:true,
    sourceVerified:true,
    stock:true
  }, now, { mode:"strict", maxAgeMinutes:10 });
  assert.equal(priceless.passed, false);
  assert.ok(priceless.blockingCodes.includes("MISSING_PRICE_VERIFICATION"));
}

// Authorized Amazon origin with coherent proof fields can pass the validator.
{
  const amazonVerified = prePublishValidate({
    amazonUrl:"https://www.amazon.it/dp/B012345678",
    lastVerifiedAt:"2026-10-04T20:59:00.000Z",
    source:"amazon_pa_api",
    priceVerified:true,
    priceVerifiedByAmazon:true,
    stock:true
  }, now, { mode:"strict", maxAgeMinutes:10 });
  assert.equal(amazonVerified.passed, true);
  assert.equal(amazonVerified.action, "ALLOW");
}


{
  assert.equal(publicationRoute({pricelessSignal:true, humanApprovedPricelessSignal:true}), "EDITORIAL_HUMAN_REVIEW");
  assert.equal(publicationRoute({commercialClaimsSuppressed:true, priceVerified:true}), "EDITORIAL_HUMAN_REVIEW");
  assert.equal(publicationRoute({priceVerified:true, stock:true}), "COMMERCIAL_STRICT");
}

console.log("pre-publish-validator selftest passed");
