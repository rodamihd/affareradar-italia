import test from 'node:test';
import assert from 'node:assert/strict';
import { redisCommand } from '../lib/redis-rest.js';
import { enqueuePublicationQueue } from '../lib/queue-enqueue.mjs';

const now=Date.parse('2026-11-02T12:00:00Z');
const body={asin:'B012345678',amazonUrl:'https://www.amazon.it/dp/B012345678',price:'20.00',priceVerified:true,verifiedAt:new Date(now-30000).toISOString()};
const oldEnv={
  url:process.env.UPSTASH_REDIS_REST_URL,
  token:process.env.UPSTASH_REDIS_REST_TOKEN
};
const oldFetch=globalThis.fetch;
function setup(fn) {
  process.env.UPSTASH_REDIS_REST_URL='https://test-only.upstash.invalid';
  process.env.UPSTASH_REDIS_REST_TOKEN='synthetic-never-real';
  globalThis.fetch=fn;
}
function restore() {
  globalThis.fetch=oldFetch;
  if(oldEnv.url===undefined)delete process.env.UPSTASH_REDIS_REST_URL;
  else process.env.UPSTASH_REDIS_REST_URL=oldEnv.url;
  if(oldEnv.token===undefined)delete process.env.UPSTASH_REDIS_REST_TOKEN;
  else process.env.UPSTASH_REDIS_REST_TOKEN=oldEnv.token;
}

test('Upstash REST contract: EVAL JSON command array, no credential leakage',async()=>{
  let observed;
  setup(async(url,options)=>{
    observed={url,options};
    return {ok:true,json:async()=>({result:['QUEUED']})};
  });
  try {
    const r=await enqueuePublicationQueue({
      body,dealId:'rest-contract',dueAt:now+60000,reason:'test',now,
      command:redisCommand,configured:true
    });
    assert.equal(r.queued,true);
    const cmd=JSON.parse(observed.options.body);
    assert.equal(observed.url,'https://test-only.upstash.invalid');
    assert.equal(observed.options.headers.Authorization,'Bearer synthetic-never-real');
    assert.equal(cmd[0],'EVAL');
    assert.equal(cmd[2],6);
    assert.equal(cmd[3],'affareradar:queue');
    assert.equal(cmd[4],'affareradar:queue:item:rest-contract');
    assert.equal(cmd[9],'affareradar:queue:dead_letter');
    assert.equal(cmd[10],'rest-contract');
    assert.equal(cmd[11],now+60000);
    assert.equal(JSON.parse(cmd[12]).body.asin,body.asin);
    assert.equal(cmd[13],14*86400);
    assert.equal(cmd[14],now);
    assert.equal(observed.options.body.includes('synthetic-never-real'),false);
  } finally { restore(); }
});

test('Upstash REST contract: HTTP and malformed responses fail closed',async()=>{
  for (const response of [
    {ok:false,status:503,json:async()=>({error:'temporarily_unavailable'})},
    {ok:true,status:200,json:async()=>({result:null})},
    {ok:true,status:200,json:async()=>({error:'READONLY'})}
  ]) {
    setup(async()=>response);
    try {
      const r=await enqueuePublicationQueue({
        body,dealId:'rest-failure',dueAt:now+60000,reason:'test',now,
        command:redisCommand,configured:true
      });
      assert.equal(r.queued,false);
      assert.equal(r.reason,'persistent_queue_write_failed');
    }finally{restore();}
  }
});
