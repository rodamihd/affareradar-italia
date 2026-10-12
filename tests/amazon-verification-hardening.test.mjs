import { attestAmazonApiResult } from "../lib/amazon-verification-attestation.js";
import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { evaluateAmazonVerification, mergeVerifiedAmazonData } from "../lib/amazon-verification-broker.js";

process.env.AMAZON_VERIFICATION_ATTESTATION_SECRET = "integration-test-only-not-a-real-production-key-123456";
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

test("reject tampering after attestation", () => {
  const body = { ...sample };
  body.amazonVerificationAttestation = attestAmazonApiResult(body);
  body.price = 1;
  assert.notEqual(evaluateAmazonVerification(body, now).state, "VERIFIED");
});
test("reject missing HMAC key", () => {
  const original = process.env.AMAZON_VERIFICATION_ATTESTATION_SECRET;
  delete process.env.AMAZON_VERIFICATION_ATTESTATION_SECRET;
  try { assert.notEqual(decision().state, "VERIFIED"); }
  finally { process.env.AMAZON_VERIFICATION_ATTESTATION_SECRET = original; }
});
test("recognize Italian localized prices", () => {
  const body = { ...sample, price:"€ 1.299,50" };
  body.amazonVerificationAttestation = attestAmazonApiResult(body);
  assert.equal(evaluateAmazonVerification(body, now).hasPositivePrice, true);
});

// Static boundary tests: verify the route returns before any PREAPI side effects.
test("PREAPI entry is fail-closed ahead of Redis and Telegram calls", () => {
  const source = readFileSync(new URL("../api/discover-multisource.js", import.meta.url), "utf8");
  const start = source.indexOf("async function submitPreApi(req, deal) {");
  assert.ok(start >= 0);
  const end = source.indexOf("\nasync function ", start + 10);
  const fn = source.slice(start, end > start ? end : undefined);
  const gate = fn.indexOf('reason:"preapi_unattested_publication_disabled"');
  const redis = fn.indexOf('redisCommand(');
  const telegram = fn.indexOf('/api/telegram');
  assert.ok(gate > 0 && redis > gate && telegram > gate);
  assert.match(fn.slice(0, gate + 65), /return\s*\{/);
});
test("Telegram special flows and unauthenticated production test are fail-closed", () => {
  const source = readFileSync(new URL("../api/telegram.js", import.meta.url), "utf8");
  assert.match(source, /process\.env\.NODE_ENV !== "production"/);
  assert.match(source, /req\.headers\["x-affareradar-secret"\] === process\.env\.PUBLISH_SECRET/);
  assert.match(source, /special_publication_review_required/);
  assert.match(source, /amazon_attestation_required/);
});

test("Telegram handler rejects unauthenticated requests without network calls", async () => {
  const { default: handler } = await import("../api/telegram.js");
  const old = {
    PUBLISH_SECRET:process.env.PUBLISH_SECRET,
    NODE_ENV:process.env.NODE_ENV,
    AFFARERADAR_TEST_MESSAGE_ENABLED:process.env.AFFARERADAR_TEST_MESSAGE_ENABLED
  };
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  const invoke = async (method, headers = {}, query = {}) => {
    const response = { statusCode:200, payload:null, status(code) { this.statusCode=code; return this; },
      json(payload) { this.payload=payload; return this; } };
    await handler({method,headers,query,body:{}},response);
    return response;
  };
  try {
    process.env.PUBLISH_SECRET="synthetic-only-test-secret";
    process.env.NODE_ENV="production";
    process.env.AFFARERADAR_TEST_MESSAGE_ENABLED="true";
    globalThis.fetch = async () => { networkCalls++; throw new Error("network_must_not_be_called"); };
    const testGet = await invoke("GET", {}, {systemTest:"1"});
    assert.equal(testGet.statusCode,405);
    const testPost = await invoke("POST");
    assert.equal(testPost.statusCode,401);
    assert.equal(networkCalls,0);
  } finally {
    globalThis.fetch=originalFetch;
    for (const [key,value] of Object.entries(old)) {
      if (value===undefined) delete process.env[key];
      else process.env[key]=value;
    }
  }
});

test("Telegram rejects spoofed Amazon claims and special signals before network", async () => {
  const { default: handler } = await import("../api/telegram.js");
  const envKeys = ["PUBLISH_SECRET","TELEGRAM_BOT_TOKEN","TELEGRAM_CHANNEL_ID","AMAZON_VERIFICATION_ATTESTATION_SECRET"];
  const previous = Object.fromEntries(envKeys.map(k => [k,process.env[k]]));
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  try {
    process.env.PUBLISH_SECRET="synthetic-publisher-key";
    process.env.TELEGRAM_BOT_TOKEN="synthetic-telegram-token";
    process.env.TELEGRAM_CHANNEL_ID="@synthetic_testing_only";
    delete process.env.AMAZON_VERIFICATION_ATTESTATION_SECRET;
    globalThis.fetch=async () => { networkCalls++; throw new Error("forbidden_network"); };
    async function invoke(body) {
      const res = { statusCode:200,status(code){this.statusCode=code;return this;},
        json(data){this.payload=data;return this;} };
      await handler({method:"POST",headers:{"x-affareradar-secret":process.env.PUBLISH_SECRET},body},res);
      return res;
    }
    const base={title:"Synthetic Test",amazonUrl:"https://www.amazon.it/dp/B0C5DVGTR9",
      asin:"B0C5DVGTR9",amazonDataSource:"creators_api",priceVerifiedByAmazon:true,
      price:"26.10",oldPrice:"35.00",discount:"25%",lastVerifiedAt:new Date().toISOString()};
    const forged=await invoke(base);
    assert.equal(forged.statusCode,422);
    const priceless=await invoke({...base,price:null,oldPrice:null,discount:null,
      pricelessSignal:true,sourceVerified:true,commercialClaimsSuppressed:true});
    assert.equal(priceless.statusCode,422);
    assert.equal(priceless.payload.error,"special_publication_review_required");
    assert.equal(networkCalls,0);
  } finally {
    globalThis.fetch=originalFetch;
    for (const [k,v] of Object.entries(previous)) {
      if (v===undefined) delete process.env[k]; else process.env[k]=v;
    }
  }
});

test("Telegram rejects synthetic reward publication before network", async () => {
  const { default: handler } = await import("../api/telegram.js");
  const keys=["PUBLISH_SECRET","TELEGRAM_BOT_TOKEN","TELEGRAM_CHANNEL_ID"];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const originalFetch=globalThis.fetch;
  let calls=0;
  try {
    process.env.PUBLISH_SECRET="test-publish-secret";
    process.env.TELEGRAM_BOT_TOKEN="test-bot-token";
    process.env.TELEGRAM_CHANNEL_ID="@synthetic";
    globalThis.fetch=async()=>{calls++;throw Error("forbidden-network");};
    const res={statusCode:200,status(v){this.statusCode=v;return this;},json(v){this.payload=v;return this;}};
    await handler({method:"POST",headers:{"x-affareradar-secret":"test-publish-secret"},body:{
      title:"Synthetic program",amazonUrl:"https://www.amazon.it/dp/B0C5DVGTR9",
      asin:"B0C5DVGTR9",rewardProgram:"prime",program:"prime"
    }},res);
    assert.equal(res.statusCode,422);
    assert.equal(res.payload.error,"special_publication_review_required");
    assert.equal(calls,0);
  } finally {
    globalThis.fetch=originalFetch;
    for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  }
});

test("reference prices and promotional claims are bound to attestation", () => {
  for(const changes of [{oldPrice:"99.99"},{discount:"-50%"},{coupon:"COUPON10"},{stack:"bonus"},{historicalLow:true}]){
    const deal={...sample,oldPrice:"35.00",discount:"20%",coupon:"",stack:"",historicalLow:false};
    deal.amazonVerificationAttestation=attestAmazonApiResult(deal);
    Object.assign(deal,changes);
    assert.notEqual(evaluateAmazonVerification(deal,now).state,"VERIFIED");
  }
});

test("verification merge must preserve signed API facts over conflicting external signal", () => {
  const external = { ...sample,source:"untrusted_signal",price:"1.00",oldPrice:"200.00",
    discount:"99%",coupon:"external-coupon",historicalLow:true };
  const verified={...sample,oldPrice:"35.00",discount:"20%",coupon:null,historicalLow:false};
  verified.amazonVerificationAttestation=attestAmazonApiResult(verified);
  const merged=mergeVerifiedAmazonData(external,verified);
  assert.equal(merged.price,verified.price);
  assert.equal(merged.coupon,null);
  assert.equal(merged.historicalLow,false);
  assert.equal(merged.amazonDataSource,"creators_api");
  assert.equal(evaluateAmazonVerification(merged,now).state,"VERIFIED");
  merged.oldPrice=external.oldPrice;
  assert.notEqual(evaluateAmazonVerification(merged,now).state,"VERIFIED");
});

test("sanitization preserves trusted Amazon attestation and signed values", async () => {
  const { sanitizeForAmazonPublication } = await import("../lib/amazon-compliance.js");
  const verified = {...sample,oldPrice:"35.00",discount:"20%",priceVerifiedByAmazon:true,
    promotionVerifiedByAmazon:true,couponVerifiedByAmazon:true,coupon:"SAVE5",stack:null,
    historicalLow:false};
  verified.amazonVerificationAttestation=attestAmazonApiResult(verified);
  const output=sanitizeForAmazonPublication(verified,now);
  assert.equal(output.body.price,verified.price);
  assert.equal(output.body.oldPrice,verified.oldPrice);
  assert.equal(output.body.coupon,verified.coupon);
  assert.equal(evaluateAmazonVerification(output.body,now).state,"VERIFIED");
});

test("displayed price and effective price each invalidate signature when changed", () => {
  const base={...sample,price:"30.00",effectivePrice:"26.10"};
  base.amazonVerificationAttestation=attestAmazonApiResult(base);
  assert.equal(evaluateAmazonVerification(base,now).state,"VERIFIED");
  for(const patch of [{price:"99.99"},{effectivePrice:"1.00"}]){
    const changed={...base,...patch};
    assert.notEqual(evaluateAmazonVerification(changed,now).state,"VERIFIED");
  }
});

test("PREAPI shadow review strips commercial claims and always holds", async () => {
  const {buildShadowReview} = await import("../lib/preapi-shadow-review.js");
  const r=buildShadowReview({asin:"B0C5DVGTR9",market:"IT",
    amazonUrl:"https://www.amazon.it/dp/B0C5DVGTR9?tag=example-21",
    title:"SUPER SCONTO 90% coupon €29 Offerta imperdibile",source:"external_feed"},
    new Date("2026-10-12T10:00:00Z"));
  assert.equal(r.gate,"HOLD");
  assert.equal(r.mode,"SHADOW_ONLY");
  assert.equal(r.autoPublishAllowed,false);
  assert.equal(r.claims.currentPriceVerified,false);
  assert.equal(r.productUrl,"https://www.amazon.it/dp/B0C5DVGTR9");
  assert.doesNotMatch(r.title,/90%|coupon|€29|sconto|imperdibile/i);
});
test("PREAPI shadow review rejects identity mismatch and unsupported market", async () => {
  const {buildShadowReview} = await import("../lib/preapi-shadow-review.js");
  const mismatch=buildShadowReview({asin:"B0C5DVGTR9",amazonUrl:"https://www.amazon.it/dp/B012345678"});
  assert.equal(mismatch.productUrl,null);
  assert.equal(mismatch.reason,"unverified_product_identity");
  const bad=buildShadowReview({asin:"B0C5DVGTR9",amazonUrl:"https://www.amazon.it/dp/B0C5DVGTR9",market:"US"});
  assert.equal(bad.reason,"unsupported_market");
  assert.equal(bad.autoPublishAllowed,false);
});

test("shadow queue is nonpublishable, bounded and deduplicates product URLs", async () => {
  const {buildShadowReviewQueue} = await import("../lib/preapi-shadow-queue.js");
  const signal={asin:"B0C5DVGTR9",market:"IT",amazonUrl:"https://www.amazon.it/dp/B0C5DVGTR9",title:"Product"};
  const q=buildShadowReviewQueue([signal,signal],new Date("2026-10-12T10:00:00Z"));
  assert.equal(q.mode,"SHADOW_ONLY");
  assert.equal(q.publicationEnabled,false);
  assert.equal(q.records.length,1);
  assert.equal(q.records[0].autoPublishAllowed,false);
  assert.equal(Object.hasOwn(q.records[0],"price"),false);
});

test("shadow queue with zero limit emits no records", async () => {
  const {buildShadowReviewQueue} = await import("../lib/preapi-shadow-queue.js");
  const signal={asin:"B0C5DVGTR9",amazonUrl:"https://www.amazon.it/dp/B0C5DVGTR9"};
  const q=buildShadowReviewQueue([signal],new Date("2026-10-12T10:00:00Z"),0);
  assert.deepEqual(q.records,[]);
  assert.equal(q.decision,"HOLD");
  assert.equal(q.publicationEnabled,false);
});

test("shadow projection never echoes arbitrary commercial source text", async () => {
  const {buildShadowReview} = await import("../lib/preapi-shadow-review.js");
  const r=buildShadowReview({asin:"B0C5DVGTR9",market:"IT",amazonUrl:"https://www.amazon.it/dp/B0C5DVGTR9",title:"Price error 99% coupon €1",category:"SUPER DEAL 99%",source:"Promo 99% today"});
  assert.equal(r.title,"Prodotto da verificare");
  assert.equal(r.category,null);
  assert.equal(r.source,"external_signal");
  assert.equal(r.gate,"HOLD");
  assert.equal(r.autoPublishAllowed,false);
});
