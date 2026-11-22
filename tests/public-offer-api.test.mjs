import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePublicOffers } from '../lib/public-offers-handler.js';

const originalFetch=globalThis.fetch;
const names=['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','PUBLISH_SECRET','STOREFRONT_APPROVAL_SECRET'];
const originalEnv=Object.fromEntries(names.map(n=>[n,process.env[n]]));
let saved=[],commands=[];
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
  saved=[];commands=[];
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
  await handlePublicOffers(request('POST',{headers:auth,body:{offer:fixture()}}),p);
  assert.equal(p.code,201);
  const g=response();await handlePublicOffers(request('GET'),g);
  assert.equal(g.code,200);assert.equal(g.body.offers.length,1);
  assert.equal(g.body.offers[0].price_eur,12.5);
  assert.equal(Object.hasOwn(g.body.offers[0],'review_reference'),false);
  assert.deepEqual(commands,['LPUSH','LTRIM','EXPIRE','LRANGE']);
});
test('GET ignores corrupted, expired, duplicate records',async()=>{
  setup();const good=fixture();
  saved=['not-json',JSON.stringify({...good,verified_at:'2025-01-01T10:00:00Z',expires_at:'2025-01-01T10:15:00Z'}),JSON.stringify(good),JSON.stringify(good)];
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
