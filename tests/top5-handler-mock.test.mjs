import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/daily-top5.js';

const originalFetch=globalThis.fetch;
const names=['CRON_SECRET','PUBLISH_SECRET','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN','TELEGRAM_BOT_TOKEN','TELEGRAM_CHANNEL_ID'];
const originalEnv=Object.fromEntries(names.map(n=>[n,process.env[n]]));
test.after(()=>{
  globalThis.fetch=originalFetch;
  for(const [k,v] of Object.entries(originalEnv)) if(v===undefined) delete process.env[k]; else process.env[k]=v;
});
function mockEnvironment(events) {
  process.env.CRON_SECRET='synthetic-cron';
  process.env.PUBLISH_SECRET='synthetic-publish';
  process.env.UPSTASH_REDIS_REST_URL='https://synthetic-redis.invalid';
  process.env.UPSTASH_REDIS_REST_TOKEN='synthetic-redis-token';
  process.env.TELEGRAM_BOT_TOKEN='synthetic-bot';
  process.env.TELEGRAM_CHANNEL_ID='synthetic-channel';
  const calls=[];
  globalThis.fetch=async (url,options)=>{
    calls.push({url,options});
    if(url==='https://synthetic-redis.invalid'){
      const [op,key]=JSON.parse(options.body);
      let result=null;
      if(op==='LRANGE' && key==='affareradar:events') result=events.map(JSON.stringify);
      else if(op==='LRANGE') result=[];
      else if(op==='GET') result=null;
      else if(op==='INCR') result=1;
      else if(op==='LPUSH') result=1;
      else if(op==='LTRIM') result='OK';
      else throw Error('unexpected Redis command: '+op);
      return {ok:true,json:async()=>({result})};
    }
    if(url==='https://api.telegram.org/botsynthetic-bot/sendMessage')
      return {ok:true,json:async()=>({ok:true,result:{message_id:987}})};
    throw Error('external fetch blocked: '+url);
  };
  return calls;
}
function res() {return {code:200,body:null,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
function req() {return {method:'GET',headers:{authorization:'Bearer synthetic-cron'}};}
function event(overrides={}) {
  const now=Date.now();
  return {event:'published',at:new Date(now-20000).toISOString(),
    dealId:'B012345678',asin:'B012345678',title:'Synthetic offer',category:'Tech',
    amazonUrl:'https://www.amazon.it/dp/B012345678?tag=example-21',
    stock:true,price:'12,50 €',discount:'-15%',dealScore:90,
    verification:{state:'VERIFIED',verifiedAt:new Date(now-60000).toISOString()},
    agentLifecycle:{status:'PUBLISHED',validUntil:new Date(now+600000).toISOString()},
    ...overrides};
}
test('no eligible deals sends no Telegram request',async()=>{
  const calls=mockEnvironment([]),r=res();await handler(req(),r);
  assert.equal(r.code,200);assert.equal(r.body.published,false);
  assert.equal(calls.some(x=>x.url.includes('api.telegram.org')),false);
});
test('expired or stale lifecycle blocks Telegram request',async()=>{
  const calls=mockEnvironment([event({agentLifecycle:{status:'EXPIRED'}}),event({agentLifecycle:{status:'STALE'},dealId:'B012345679'})]);
  const r=res();await handler(req(),r);
  assert.equal(r.body.published,false);
  assert.equal(calls.some(x=>x.url.includes('api.telegram.org')),false);
});
test('fresh eligible deal sends only a synthetic Telegram request',async()=>{
  const calls=mockEnvironment([event()]),r=res();await handler(req(),r);
  assert.equal(r.code,200);assert.equal(r.body.published,true);
  assert.equal(r.body.telegram_message_id,987);
  const sends=calls.filter(x=>x.url.includes('api.telegram.org'));
  assert.equal(sends.length,1);
  assert.match(JSON.parse(sends[0].options.body).text,/Synthetic offer/);
});
test('unknown stock blocks Telegram request',async()=>{
  const calls=mockEnvironment([event({stock:undefined})]),r=res();await handler(req(),r);
  assert.equal(r.body.published,false);
  assert.equal(calls.some(x=>x.url.includes('api.telegram.org')),false);
});
