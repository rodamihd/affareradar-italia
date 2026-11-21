import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { processDueItem, CLAIM_LUA } from '../lib/queue-delivery.mjs';
import { enqueuePublicationQueue, QUEUE_ITEM_TTL_SECONDS } from '../lib/queue-enqueue.mjs';

// Test-only Docker container, no credentials or outbound publications.
const enabled = process.env.QUEUE_REDIS_INTEGRATION === '1';
const container = 'affareradar-queue-redis-test';
function redis(cmd, ...args) {
  const stdout = execFileSync('docker', ['exec', container, 'redis-cli', '--json', cmd, ...args.map(String)], {
    encoding:'utf8', timeout:5000, maxBuffer:1024*1024
  }).trim();
  const response = JSON.parse(stdout);
  if (response && typeof response === 'object' && response.err) throw Error('redis_error:' + response.err);
  return response;
}
async function command(cmd,...args) { return { configured:true, result:redis(cmd,...args) }; }
const itemKey=id=>'affareradar:queue:item:'+id;
const reviewKey=id=>'affareradar:queue:review:item:'+id;
function body(now,extra={}) {
  return { asin:'B012345678', amazonUrl:'https://www.amazon.it/dp/B012345678', price:'20.00',
    priceVerified:true, verifiedAt:new Date(now-60000).toISOString(), stock:true,...extra };
}
function seed(id,now,extra={}) {
  const item={body:body(now,extra),dealId:id,attempts:0,dueAt:now};
  assert.equal(redis('SET',itemKey(id),JSON.stringify(item),'EX','600'),'OK');
  redis('ZADD','affareradar:queue',now,id);
}
function deliver(id,now,publish) {
  return processDueItem({ redisCommand:command, publish, dealId:id, now });
}
const published=async()=>({status:200,data:{ok:true,published:true,telegram_message_id:42}});

test('real Redis EVAL: confirmed delivery ACK only after send', {skip:!enabled}, async()=>{
  const id='redistest-ack',now=Date.now();seed(id,now);
  let queued=false;
  const r=await deliver(id,now,async()=>{queued=redis('ZSCORE','affareradar:queue',id)!==null;return published();});
  assert.equal(queued,true);assert.equal(r.finalize,'ACKED');
  assert.equal(redis('GET',itemKey(id)),null);
  assert.equal(redis('ZSCORE','affareradar:queue',id),null);
});

test('real Redis EVAL: unknown delivery quarantines, no retry', {skip:!enabled}, async()=>{
  const id='redistest-review',now=Date.now();seed(id,now);
  let sends=0;
  const r=await deliver(id,now,async()=>{sends++;throw Error('synthetic_timeout');});
  assert.equal(r.finalize,'MANUAL_REVIEW');
  assert.notEqual(redis('GET',reviewKey(id)),null);
  assert.notEqual(redis('ZSCORE','affareradar:queue:review',id),null);
  await deliver(id,now,async()=>{sends++;return published();});
  assert.equal(sends,1);
});

test('real Redis EVAL: stale price cannot reach publisher', {skip:!enabled}, async()=>{
  const id='redistest-stale',now=Date.now();
  seed(id,now,{verifiedAt:new Date(now-3600000).toISOString()});
  let sends=0;
  const r=await deliver(id,now,async()=>{sends++;return published();});
  assert.equal(sends,0);assert.equal(r.finalize,'MANUAL_REVIEW');
  assert.notEqual(redis('ZSCORE','affareradar:queue:review',id),null);
  assert.equal(redis('ZSCORE','affareradar:queue',id),null);
});

test('real Redis EVAL: anti-spam deferral releases lease, retains item and updates due time', {skip:!enabled},async()=>{
  const id='redistest-defer',now=Date.now();seed(id,now);
  const next=now+120000;
  const r=await deliver(id,now,async()=>({
    status:200,data:{ok:true,published:false,decision:'deferred',reason:'anti_spam',nextAttemptAt:new Date(next).toISOString()}
  }));
  assert.equal(r.finalize,'DEFERRED');
  assert.equal(Number(redis('ZSCORE','affareradar:queue',id)),next);
  assert.equal(redis('GET','affareradar:queue:lease:'+id),null);
  assert.equal(redis('GET','affareradar:queue:journal:'+id),null);
  const item=JSON.parse(redis('GET',itemKey(id)));
  assert.equal(item.attempts,0);
  assert.equal(item.deferCount,1);
});
test('real Redis EVAL: deferral past freshness holds for manual re-verification', {skip:!enabled},async()=>{
  const id='redistest-defer-stale',now=Date.now();seed(id,now);
  const next=now+3600000;
  const r=await deliver(id,now,async()=>({
    status:200,data:{ok:true,published:false,decision:'deferred',reason:'anti_spam',nextAttemptAt:new Date(next).toISOString()}
  }));
  assert.equal(r.finalize,'MANUAL_REVIEW');
  assert.equal(r.reason,'reverification_required_before_deferral');
  assert.equal(redis('ZSCORE','affareradar:queue',id),null);
  assert.notEqual(redis('ZSCORE','affareradar:queue:review',id),null);
  assert.notEqual(redis('GET',reviewKey(id)),null);
});

test('real Redis EVAL: two workers cannot send same item concurrently', {skip:!enabled}, async()=>{
  const id='redistest-concurrent',now=Date.now();seed(id,now);
  let release,started, sends=0;
  const gate=new Promise(resolve=>{started=resolve;});
  const first=deliver(id,now,async()=>{
    sends++;started();await new Promise(resolve=>{release=resolve;});return published();
  });
  await gate;
  const second=await deliver(id,now,async()=>{sends++;return published();});
  assert.equal(second.status,'locked');
  release();assert.equal((await first).finalize,'ACKED');assert.equal(sends,1);
});

test('real Redis EVAL: abandoned journal goes to review on next poll', {skip:!enabled}, async()=>{
  const id='redistest-abandon',now=Date.now();seed(id,now);
  const keys=['affareradar:queue',itemKey(id),'affareradar:queue:lease:'+id,
    'affareradar:queue:journal:'+id,'affareradar:queue:review',reviewKey(id)];
  const claim=redis('EVAL',CLAIM_LUA,keys.length,...keys,id,now,'fake-worker-token',180,86400);
  assert.equal(claim[0],'CLAIMED');
  redis('DEL','affareradar:queue:lease:'+id);
  let sends=0;
  const out=await deliver(id,now,async()=>{sends++;return published();});
  assert.equal(sends,0);assert.equal(out.status,'uncertain_review');
  assert.notEqual(redis('ZSCORE','affareradar:queue:review',id),null);
});


async function enqueue(id,now,overrides={}) {
  return enqueuePublicationQueue({
    body:body(now),dealId:id,dueAt:now+60000,reason:'test',now,
    command,configured:true,...overrides
  });
}
test('real Redis EVAL: enqueue persists payload and schedule atomically with 14d TTL', {skip:!enabled},async()=>{
  const id='redistest-enqueue',now=Date.now();
  const r=await enqueue(id,now);
  assert.equal(r.queued,true);assert.equal(r.status,'queued');
  const ttl=Number(redis('TTL',itemKey(id)));
  assert.ok(ttl>QUEUE_ITEM_TTL_SECONDS-120 && ttl<=QUEUE_ITEM_TTL_SECONDS);
  assert.notEqual(redis('ZSCORE','affareradar:queue',id),null);
});
test('real Redis EVAL: duplicate enqueue never replaces pending payload', {skip:!enabled},async()=>{
  const id='redistest-enqueue-repeat',now=Date.now();
  assert.equal((await enqueue(id,now)).status,'queued');
  const original=redis('GET',itemKey(id));
  const duplicate=await enqueue(id,now,{body:body(now,{price:'1.00'})});
  assert.equal(duplicate.status,'already_queued');
  assert.equal(redis('GET',itemKey(id)),original);
});
test('real Redis EVAL: an in-flight delivery cannot be overwritten', {skip:!enabled},async()=>{
  const id='redistest-enqueue-lock',now=Date.now();
  assert.equal((await enqueue(id,now)).queued,true);
  redis('SET','affareradar:queue:journal:'+id,'unresolved','EX','60');
  const r=await enqueue(id,now,{body:body(now,{price:'0.10'})});
  assert.equal(r.queued,false);assert.equal(r.reason,'in_flight');
});
test('real Redis EVAL: reject orphaned item references instead of claiming success', {skip:!enabled},async()=>{
  const id='redistest-enqueue-orphan',now=Date.now();
  redis('ZADD','affareradar:queue',now,id);
  const r=await enqueue(id,now);
  assert.equal(r.queued,false);assert.equal(r.reason,'orphaned_queue_entry');
  assert.equal(redis('GET',itemKey(id)),null);
});
test('real Redis EVAL: delayed beyond retention cannot be queued', {skip:!enabled},async()=>{
  const id='redistest-enqueue-expiry',now=Date.now();
  const r=await enqueue(id,now,{dueAt:now+QUEUE_ITEM_TTL_SECONDS*1000});
  assert.equal(r.queued,false);assert.equal(redis('GET',itemKey(id)),null);
});
test('fail-closed when persistent queue is not configured or command fails',async()=>{
  const now=Date.now(),id='redistest-no-persistence';
  const absent=await enqueue(id,now,{configured:false});
  assert.equal(absent.queued,false);
  const failed=await enqueue(id,now,{command:async()=>{throw Error('network_failure')}});
  assert.equal(failed.queued,false);assert.equal(failed.reason,'persistent_queue_write_failed');
});
