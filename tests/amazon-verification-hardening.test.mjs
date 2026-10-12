import { attestAmazonApiResult } from "../lib/amazon-verification-attestation.js";
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAmazonVerification } from "../lib/amazon-verification-broker.js";

const now = Date.parse("2026-10-12T12:00:00Z");
const sample = {
  asin: "B0C5DVGTR9",
  amazonUrl: "https://www.amazon.it/dp/B0C5DVGTR9",
  amazonDataSource: "creators_api",
  price: 26.10,
  lastVerifiedAt: "2026-10-12T11:59:00Z"
};
function decision(overrides = {}) {
  const body = { ...sample, ...overrides };
  if (overrides.amazonDataSource === undefined && overrides.priceVerifiedByAmazon !== false) body.amazonVerificationAttestation = attestAmazonApiResult(body);
  return evaluateAmazonVerification(body, now);
}

test("fresh API-labeled product has matching ASIN and positive price", () => {
  const result = decision();
  assert.equal(result.asinMatchesUrl, true);
  assert.equal(result.hasPositivePrice, true);
  assert.equal(result.state, "VERIFIED");
});

test("reject caller-supplied verified boolean without source", () => {
  assert.notEqual(decision({ amazonDataSource: "rss", priceVerifiedByAmazon: true }).state, "VERIFIED");
});
test("reject future timestamp", () => {
  assert.notEqual(decision({ lastVerifiedAt: "2026-10-12T12:05:00Z" }).state, "VERIFIED");
});
test("reject expired timestamp", () => {
  assert.notEqual(decision({ lastVerifiedAt: "2026-10-12T11:40:00Z" }).state, "VERIFIED");
});
test("reject mismatching ASIN", () => {
  assert.notEqual(decision({ asin: "B012345678" }).state, "VERIFIED");
});
test("reject missing, zero, or negative prices", () => {
  for (const price of [undefined, 0, -2, "not-a-price"]) {
    assert.notEqual(decision({ price, effectivePrice: price }).state, "VERIFIED");
  }
});
test("reject non-Amazon HTTPS link and mismatching link", () => {
  for (const amazonUrl of ["http://www.amazon.it/dp/B0C5DVGTR9", "https://evil.example/dp/B0C5DVGTR9", "https://www.amazon.it/dp/B012345678"]) {
    assert.notEqual(decision({ amazonUrl }).state, "VERIFIED");
  }
});
test("reject a self-declared official source without trusted server-side attestation", () => {
  // This is an intentional red test documenting the remaining trust-boundary defect.
  assert.notEqual(decision({ amazonDataSource: "creators_api", priceVerifiedByAmazon: false }).state, "VERIFIED");
});
