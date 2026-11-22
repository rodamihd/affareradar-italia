import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePublicOffers } from '../lib/public-offers-handler.js';
import { offerEvidenceDigest, storefrontEvidenceKey } from '../lib/storefront-evidence-gate.js';
import { storefrontPriceProofKey, canonicalPriceAttestation } from '../lib/creators-price-attestation.js';
import crypto from 'node:crypto';

const originalFetch=globalThis.fetch;
const names=['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','PUBLISH_SECRET','STOREFRONT_APPROVAL_SECRET','VERCEL_ENV','AFFARERADAR_STOREFRONT_INGEST_ENABLED','AFFARERADAR_CREATORS_PRICE_PUBLIC_KEY_PEM'];
const originalEnv=Object.fromEntries(names.map(n=>[n,process.env[n]]));
let saved=[],commands=[],reviews=new Map(),priceProofs=new Map();
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const publicPem=publicKey.export({type:'spki',format:'pem'});
function signedProof(offer) {
  const asin=new URL(offer.url).pathname.split('/').filter(Boolean).at(-1)?.toUpperCase();
  const claims={schema_version:1,issuer:'affareradar_creators_verifier_it_v1',
    source:'amazon_creators_api_getitems_offersv2',marketplace:'www.amazon.it',
    asin,offer_digest:offerEvidenceDigest(offer),currency:'EUR',
    price_cents:Math.round(offer.price_eur*100),availability:'IN_STOCK',
    observed_at:offer.verified_at,retrieval_reference:'fixture_retrieval_001',
    license_review_reference:'fixture_license_001'};
  return JSON.stringify({schema_version:1,claims,signature:crypto.sign(null,canonicalPriceAttestation(claims),privateKey).toString('base64url')});
}
function addTrustedReview(offer, overrides={}) {
  priceProofs.set(storefrontPriceProofKey(offer.review_reference),signedProof(offer));
  reviews.set(storefrontEvidenceKey(offer.review_reference), JSON.stringify({
    schema_version:1,review_reference:offer.review_reference,decision:'APPROVED',marketplace:'IT',
    offer_digest:offerEvidenceDigest(offer),
    provider_reviewer_id:'provider_qa_1',editorial_reviewer_id:'editor_qa_2',
    licensed_display_reviewed:true,price_source_reviewed:true,shipping_checked:true,
    stock_checked:true,stock_status:'IN_STOCK',license_reference:'license_fixture_001',
    source_evidence_reference:'evidence_fixture_001',reviewed_at:new Date().toISOString(),
    ...overrides
  }));
}
function fixture() {
  const now=Date.now();
  return {
    status:'approved',source_authorized:true,rights_verified:true,
    price_verified_by_amazon:true,price_source:'creators_api',
    review_reference:'review_20261122_001',title:'Synthetic desk item',
    merchant:'Amazon Italia',price_eur:12.5,
    verified_at:new Date(now-1000).toISOString(),
    expires_at:new Date(now+300000).toISOString(),
    url:'https://www.amazon.it/dp/B012345678?tag=example-21'
  };
}
function response() {
  return {code:200,headers:{},body:null,setHeader(k,v){this.headers[k.toLowerCase()]=v;},
    status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
}
function request(method,opts={}) {return {method,headers:{},body:{},query:{},...opts};}
function setup() {
  saved=[];commands=[];reviews=new Map();priceProofs=new Map();
  process.env.AFFARERADAR_CREATORS_PRICE_PUBLIC_KEY_PEM=publicPem;
  process.env.VERCEL_ENV='production';
  process.env.AFFARERADAR_STOREFRONT_INGEST_ENABLED='true';
  process.env.UPSTASH_REDIS_REST_URL='https://synthetic-redis.invalid';
  process.env.UPSTASH_REDIS_REST_TOKEN='synthetic-token';
  process.env.PUBLISH_SECRET='synthetic-publish';
  process.env.STOREFRONT_APPROVAL_SECRET='synthetic-approval';
  globalThis.fetch=async (url,options)=>{
    assert.equal(url,'https://synthetic-redis.invalid');
    const [op,...args]=JSON.parse(options.body);
    commands.push(op);
    let result;
    if(op==='LRANGE') result=saved.slice(Number(args[1]),Number(args[2])+1);
    else if(op==='GET') result=reviews.get(args[0])||priceProofs.get(args[0])||null;
    else if(op==='LPUSH'){saved.unshift(args[1]);result=saved.length;}
    else if(op==='LTRIM'){saved=saved.slice(0,100);result='OK';}
    else if(op==='EXPIRE') result=1;
    else throw Error('unexpected command: '+op);
    return {ok:true,json:async()=>({result})};
  };
}
const auth={'x-affareradar-secret':'synthetic-publish','x-affareradar-storefront-approval':'synthetic-approval'};
test.after(()=>{
  globalThis.fetch=originalFetch;
  for(const [k,v] of Object.entries(originalEnv)) if(v===undefined) delete process.env[k]; else process.env[k]=v;
});
test('GET is public, empty, and no-cache',async()=>{
  setup();const r=response();await handlePublicOffers(request('GET'),r);
  assert.equal(r.code,200);assert.deepEqual(r.body,{schema_version:1,offers:[]});
  assert.equal(r.headers['cache-control'],'no-store, max-age=0');
});
test('POST denies without approval credential',async()=>{
  setup();const r=response();
  await handlePublicOffers(request('POST',{headers:{'x-affareradar-secret':'synthetic-publish'},body:{offer:fixture()}}),r);
  assert.equal(r.code,401);assert.deepEqual(commands,[]);
});
test('POST denies unapproved record',async()=>{
  setup();const r=response();
  await handlePublicOffers(request('POST',{headers:auth,body:{offer:{...fixture(),rights_verified:false}}}),r);
  assert.equal(r.code,422);assert.deepEqual(commands,[]);
});
test('POST and GET return one reviewed item without review reference',async()=>{
  setup();const p=response();
  const offer=fixture();addTrustedReview(offer);
  await handlePublicOffers(request('POST',{headers:auth,body:{offer}}),p);
  assert.equal(p.code,201);
  const g=response();await handlePublicOffers(request('GET'),g);
  assert.equal(g.code,200);assert.equal(g.body.offers.length,1);
  assert.equal(g.body.offers[0].price_eur,12.5);
  assert.equal(Object.hasOwn(g.body.offers[0],'review_reference'),false);
  assert.deepEqual(commands,['GET','GET','LPUSH','LTRIM','EXPIRE','LRANGE','GET','GET']);
});
test('GET ignores corrupted, expired, duplicate records',async()=>{
  setup();const good=fixture();
  saved=['not-json',JSON.stringify({...good,verified_at:'2025-01-01T10:00:00Z',expires_at:'2025-01-01T10:15:00Z'}),JSON.stringify(good),JSON.stringify(good)];
  addTrustedReview(good);
  const r=response();await handlePublicOffers(request('GET'),r);
  assert.equal(r.code,200);assert.equal(r.body.offers.length,1);
});
test('GET fails closed without Redis credentials',async()=>{
  setup();delete process.env.UPSTASH_REDIS_REST_URL;
  const r=response();await handlePublicOffers(request('GET'),r);
  assert.equal(r.code,503);assert.equal(r.body.error,'storefront_unavailable');
});
test('unrecognized method rejected without Redis calls',async()=>{
  setup();const r=response();await handlePublicOffers(request('DELETE'),r);
  assert.equal(r.code,405);assert.deepEqual(commands,[]);
});
test('same secret cannot serve both roles',async()=>{
  setup();process.env.STOREFRONT_APPROVAL_SECRET='synthetic-publish';
  const r=response();
  await handlePublicOffers(request('POST',{headers:{'x-affareradar-secret':'synthetic-publish','x-affareradar-storefront-approval':'synthetic-publish'},body:{offer:fixture()}}),r);
  assert.equal(r.code,401);assert.deepEqual(commands,[]);
});

test('ingest fails closed without a separate independent review record',async()=>{
  setup();const r=response();
  await handlePublicOffers(request('POST',{headers:auth,body:{offer:fixture()}}),r);
  assert.equal(r.code,422);assert.equal(r.body.error,'trusted_review_missing');
  assert.deepEqual(commands,['GET']);
});
test('forged review digest is rejected',async()=>{
  setup();const offer=fixture();addTrustedReview(offer,{offer_digest:'f'.repeat(64)});
  const r=response();await handlePublicOffers(request('POST',{headers:auth,body:{offer}}),r);
  assert.equal(r.code,422);assert.equal(r.body.error,'trusted_review_digest_mismatch');
});
test('one reviewer cannot approve both evidence and editorial decision',async()=>{
  setup();const offer=fixture();addTrustedReview(offer,{editorial_reviewer_id:'provider_qa_1'});
  const r=response();await handlePublicOffers(request('POST',{headers:auth,body:{offer}}),r);
  assert.equal(r.code,422);assert.equal(r.body.error,'independent_reviewers_required');
});
test('preview never accepts writes or reads potentially shared production feed',async()=>{
  setup();const offer=fixture();addTrustedReview(offer);
  process.env.VERCEL_ENV='preview';
  const p=response();await handlePublicOffers(request('POST',{headers:auth,body:{offer}}),p);
  assert.equal(p.code,403);assert.equal(p.body.error,'storefront_preview_write_disabled');
  const g=response();await handlePublicOffers(request('GET'),g);
  assert.deepEqual(g.body,{schema_version:1,offers:[]});assert.deepEqual(commands,[]);
});
test('ingest is off unless explicitly enabled',async()=>{
  setup();const offer=fixture();addTrustedReview(offer);
  delete process.env.AFFARERADAR_STOREFRONT_INGEST_ENABLED;
  const r=response();await handlePublicOffers(request('POST',{headers:auth,body:{offer}}),r);
  assert.equal(r.code,403);assert.equal(r.body.error,'storefront_ingest_disabled');
  assert.deepEqual(commands,[]);
});
test('revoked review blocks an item already in feed',async()=>{
  setup();const offer=fixture();addTrustedReview(offer);saved=[JSON.stringify(offer)];
  reviews.delete(storefrontEvidenceKey(offer.review_reference));
  const r=response();await handlePublicOffers(request('GET'),r);
  assert.equal(r.code,200);assert.deepEqual(r.body.offers,[]);
});

test('signed price proof is mandatory even with approved editorial record',async()=>{
  setup();const offer=fixture();addTrustedReview(offer);priceProofs.clear();
  const r=response();await handlePublicOffers(request('POST',{headers:auth,body:{offer}}),r);
  assert.equal(r.code,422);assert.equal(r.body.error,'signed_price_proof_missing');
});
test('signed proof with wrong price cannot reach the public feed',async()=>{
  setup();const offer=fixture();addTrustedReview(offer);
  const proofKey=storefrontPriceProofKey(offer.review_reference);
  const proof=JSON.parse(priceProofs.get(proofKey));
  proof.claims.price_cents+=1;
  priceProofs.set(proofKey,JSON.stringify(proof));
  const r=response();await handlePublicOffers(request('POST',{headers:auth,body:{offer}}),r);
  assert.equal(r.code,422);assert.equal(r.body.error,'price_proof_claim_mismatch');
});
test('missing public verifier key blocks ingestion',async()=>{
  setup();const offer=fixture();addTrustedReview(offer);
  delete process.env.AFFARERADAR_CREATORS_PRICE_PUBLIC_KEY_PEM;
  const r=response();await handlePublicOffers(request('POST',{headers:auth,body:{offer}}),r);
  assert.equal(r.code,422);assert.equal(r.body.error,'price_proof_key_not_configured');
});
test('revoked price proof removes a previously reviewed item from feed',async()=>{
  setup();const offer=fixture();addTrustedReview(offer);saved=[JSON.stringify(offer)];
  priceProofs.delete(storefrontPriceProofKey(offer.review_reference));
  const r=response();await handlePublicOffers(request('GET'),r);
  assert.equal(r.code,200);assert.deepEqual(r.body.offers,[]);
});
