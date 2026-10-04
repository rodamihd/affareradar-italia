import assert from "node:assert/strict";
import { prePublishValidate, rewardPrePublishValidate } from "./pre-publish-validator.js";

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

console.log("pre-publish-validator selftest passed");
