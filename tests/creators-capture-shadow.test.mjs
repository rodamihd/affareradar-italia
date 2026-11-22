import test from "node:test";
import assert from "node:assert/strict";
import {inspectCreatorsCapture} from "../lib/creators-capture-shadow.js";

const now=Date.parse("2026-11-23T00:00:00Z");
const resources=[
  "offersV2.listings.price","offersV2.listings.availability",
  "offersV2.listings.condition","offersV2.listings.isBuyBoxWinner",
  "offersV2.listings.merchantInfo"
];
function capture(){
  return {
    schema:"affareradar.creators.getitems.capture.v1",
    source:"amazon_creators_api_export_claim",
    http_status:200,marketplace:"www.amazon.it",
    observed_at:"2026-11-22T23:58:00Z",
    retrieval_reference:"fixture_capture_0001",license_review_reference:"fixture_license_0001",
    request:{itemIds:["B012345678"],resources},
    response:{itemsResult:{items:[{
      asin:"B012345678",detailPageURL:"https://www.amazon.it/dp/B012345678",
      offersV2:{listings:[{
        isBuyBoxWinner:true,condition:{value:"New"},
        availability:{type:"IN_STOCK"},merchantInfo:{id:"SELLER001",name:"Example retailer"},
        price:{money:{amount:"4.99",currency:"EUR"}}
      }]}
    }]}}
  };
}
function check(obj){return inspectCreatorsCapture(obj,now);}
test("valid synthetic snapshot stays SHADOW_ONLY, never signed or published",()=>{
  const x=check(capture());
  assert.equal(x.ok,true);assert.equal(x.decision,"SCHEMA_OK_SHADOW_ONLY");
  assert.equal(x.observed.price_cents,499);
  assert.equal(x.provider_origin_verified,false);
  assert.equal(x.signing_allowed,false);assert.equal(x.publication_allowed,false);
  assert.equal(x.shipping_verified,false);
});
test("rejects untrusted marketplace",()=>assert.equal(check({...capture(),marketplace:"www.amazon.de"}).ok,false));
test("rejects stale capture",()=>assert.equal(check({...capture(),observed_at:"2026-11-22T23:30:00Z"}).ok,false));
test("rejects future capture",()=>assert.equal(check({...capture(),observed_at:"2026-11-23T00:01:00Z"}).ok,false));
test("rejects partial requested item",()=>{
  const x=capture();x.response.itemsResult.items[0].asin="B012345679";
  assert.equal(check(x).reason,"asin_or_detail_url_mismatch");
});
test("rejects non-matching product URL",()=>{
  const x=capture();x.response.itemsResult.items[0].detailPageURL="https://www.amazon.it/dp/B012345679";
  assert.equal(check(x).ok,false);
});
test("rejects lookalike merchant URL",()=>{
  const x=capture();x.response.itemsResult.items[0].detailPageURL="https://amazon.it.fake.example/dp/B012345678";
  assert.equal(check(x).ok,false);
});
test("rejects missing price",()=>{
  const x=capture();delete x.response.itemsResult.items[0].offersV2.listings[0].price;
  assert.equal(check(x).ok,false);
});
test("rejects imprecise price",()=>{
  const x=capture();x.response.itemsResult.items[0].offersV2.listings[0].price.money.amount="4.999";
  assert.equal(check(x).reason,"price_precision_or_range_invalid");
});
test("rejects USD price",()=>{
  const x=capture();x.response.itemsResult.items[0].offersV2.listings[0].price.money.currency="USD";
  assert.equal(check(x).reason,"wrong_currency");
});
test("rejects unavailable stock",()=>{
  const x=capture();x.response.itemsResult.items[0].offersV2.listings[0].availability.type="OUT_OF_STOCK";
  assert.equal(check(x).reason,"stock_not_confirmed");
});
test("rejects ambiguous multiple listings",()=>{
  const x=capture();x.response.itemsResult.items[0].offersV2.listings.push(x.response.itemsResult.items[0].offersV2.listings[0]);
  assert.equal(check(x).reason,"listing_ambiguous_or_missing");
});
test("rejects missing seller",()=>{
  const x=capture();delete x.response.itemsResult.items[0].offersV2.listings[0].merchantInfo;
  assert.equal(check(x).reason,"merchant_identity_missing");
});
test("rejects incomplete resource request",()=>{
  const x=capture();x.request.resources=["offersV2.listings.price"];
  assert.equal(check(x).reason,"request_identity_or_resources_invalid");
});
test("rejects response partial errors",()=>{
  const x=capture();x.response.errors=[{code:"MissingOffer"}];
  assert.equal(check(x).reason,"response_errors_or_invalid_shape");
});
test("rejects restricted promotions",()=>{
  const x=capture();x.response.itemsResult.items[0].offersV2.listings[0].dealDetails={accessType:"PRIME"};
  assert.equal(check(x).reason,"deal_access_restricted");
});
test("rejects finished deals",()=>{
  const x=capture();x.response.itemsResult.items[0].offersV2.listings[0].dealDetails={endTime:"2026-11-22T23:59:00Z"};
  assert.equal(check(x).reason,"deal_ended");
});
test("rejects missing review reference",()=>{
  const x=capture();delete x.license_review_reference;
  assert.equal(check(x).reason,"review_references_missing");
});
test("rejects oversized export",()=>{
  const x=capture();x.extra="X".repeat(140000);
  assert.equal(check(x).reason,"capture_too_large");
});
