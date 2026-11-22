import test from "node:test";
import assert from "node:assert/strict";
import { validateApprovedOffer } from "../lib/public-offer-validation.js";

const now = Date.parse("2026-11-22T17:00:00Z");
const valid = {
  status:"approved",
  source_authorized:true,
  rights_verified:true,
  price_verified_by_amazon:true,
  price_source:"creators_api",
  review_reference:"review_20261122_001",
  title:"Prodotto di esempio",
  merchant:"Amazon Italia",
  price_eur:12.50,
  verified_at:"2026-11-22T16:56:00Z",
  expires_at:"2026-11-22T17:30:00Z",
  url:"https://www.amazon.it/dp/B012345678?tag=example-21"
};

test("fresh reviewed product offer is accepted and expiry is capped", () => {
  const result = validateApprovedOffer(valid, now);
  assert.equal(result.ok,true);
  assert.equal(result.offer.expires_at,"2026-11-22T17:06:00.000Z");
});

for (const [reason, change] of [
  ["approval missing",{status:"pending"}],
  ["rights missing",{rights_verified:false}],
  ["price source missing",{price_source:"external_signal"}],
  ["missing review",{review_reference:null}],
  ["stale timestamp",{verified_at:"2026-11-22T16:40:00Z"}],
  ["expired",{expires_at:"2026-11-22T16:59:00Z"}],
  ["non-Amazon URL",{url:"https://attacker.example/dp/B012345678"}],
  ["fake Amazon host",{url:"https://amazon.it.attacker.example/dp/B012345678"}],
  ["not a product URL",{url:"https://www.amazon.it/gp/bestsellers"}],
  ["no price",{price_eur:null}],
  ["future verification",{verified_at:"2026-11-22T17:05:00Z"}]
]) {
  test("rejects "+reason, () => {
    assert.equal(validateApprovedOffer({...valid,...change},now).ok,false);
  });
}
