import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { offerEvidenceDigest } from "../lib/storefront-evidence-gate.js";
import {
  canonicalPriceAttestation, storefrontPriceProofKey, validatePriceAttestation
} from "../lib/creators-price-attestation.js";

// All keys and prices in these tests are synthetic; no private key is persisted.
const {publicKey,privateKey} = crypto.generateKeyPairSync("ed25519");
const pem = publicKey.export({type:"spki",format:"pem"});
const now = Date.parse("2026-11-22T17:00:00Z");
function offer() {
  return {
    status:"approved",source_authorized:true,rights_verified:true,
    price_verified_by_amazon:true,price_source:"creators_api",
    review_reference:"review_synthetic_0001",title:"Synthetic item",
    merchant:"Amazon Italia",price_eur:4.99,
    verified_at:"2026-11-22T16:56:00Z",
    expires_at:"2026-11-22T17:04:00Z",
    url:"https://www.amazon.it/dp/B012345678?tag=synthetic-21"
  };
}
function signedProof(o,overrides={}) {
  const claims = {
    schema_version:1,issuer:"affareradar_creators_verifier_it_v1",
    source:"amazon_creators_api_getitems_offersv2",marketplace:"www.amazon.it",
    asin:"B012345678",offer_digest:offerEvidenceDigest(o),currency:"EUR",
    price_cents:499,availability:"IN_STOCK",observed_at:o.verified_at,
    retrieval_reference:"fixture_retrieval_001",license_review_reference:"fixture_license_001",
    ...overrides
  };
  return {schema_version:1,claims,signature:crypto.sign(null,canonicalPriceAttestation(claims),privateKey).toString("base64url")};
}
test("synthetic Ed25519 signature validates a matching fresh claim",()=>{
  const o=offer();
  assert.deepEqual(validatePriceAttestation(o,signedProof(o),pem,now),{
    ok:true,reason:"signed_claims_verified_not_live_provider_verified"
  });
});
test("unsigned or missing proof is rejected",()=>assert.equal(validatePriceAttestation(offer(),null,pem,now).ok,false));
test("no configured key rejects even a correctly signed claim",()=>{
  const o=offer();assert.equal(validatePriceAttestation(o,signedProof(o),null,now).reason,"price_proof_key_not_configured");
});
test("wrong configured key rejects",()=>{
  const o=offer();const other=crypto.generateKeyPairSync("ed25519").publicKey.export({type:"spki",format:"pem"});
  assert.equal(validatePriceAttestation(o,signedProof(o),other,now).ok,false);
});
test("modified price rejects an older claim even with valid signature",()=>{
  const o=offer();const proof=signedProof(o);
  assert.equal(validatePriceAttestation({...o,price_eur:3.99},proof,pem,now).reason,"price_proof_claim_mismatch");
});
test("changed product URL rejects an older claim",()=>{
  const o=offer();const proof=signedProof(o);
  assert.equal(validatePriceAttestation({...o,url:"https://www.amazon.it/dp/B012345679"},proof,pem,now).ok,false);
});
test("expired proof rejects a correctly signed claim",()=>{
  const o=offer();assert.equal(validatePriceAttestation(o,signedProof(o),pem,now+11*60000).reason,"price_proof_stale");
});
test("replay against another review ref is rejected",()=>{
  const o=offer();const proof=signedProof(o);
  assert.equal(validatePriceAttestation({...o,review_reference:"review_synthetic_0002"},proof,pem,now).ok,false);
});
test("tampered signature is rejected",()=>{
  const o=offer();const proof=signedProof(o);proof.signature="A".repeat(86);
  assert.equal(validatePriceAttestation(o,proof,pem,now).reason,"price_proof_signature_invalid");
});
test("wrong currency, missing stock and wrong marketplace blocked",()=>{
  for(const claims of [{currency:"USD"},{availability:"UNKNOWN"},{marketplace:"www.amazon.de"}]){
    const o=offer();assert.equal(validatePriceAttestation(o,signedProof(o,claims),pem,now).ok,false);
  }
});
test("non-cent-exact price and non-Creators source rejected",()=>{
  const o=offer();const proof=signedProof(o);
  assert.equal(validatePriceAttestation({...o,price_eur:4.991},proof,pem,now).ok,false);
  assert.equal(validatePriceAttestation({...o,price_source:"external_signal"},proof,pem,now).ok,false);
});
test("independent key path is stable for well-formed references",()=>{
  assert.equal(storefrontPriceProofKey("review_synthetic_0001"),"affareradar:storefront:price-proof:v1:review_synthetic_0001");
  assert.equal(storefrontPriceProofKey("no"),null);
});
