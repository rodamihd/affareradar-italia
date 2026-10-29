import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAIM_LUA,FINALIZE_LUA,processDueItem,processQueueBatch,retryDelayMs,classifyPublishResponse
} from '../lib/queue-delivery.mjs';
const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const validBody=(diff={})=>({
  asin:'B012345678',amazonUrl:'https://www.amazon.it/dp/B012345678',
  price:'20.00',priceVerified:true,verifiedAt:new Date(NOW-60*1000).toISOString(),
  stock:true,...diff
});

// Fake Redis implements the exact atomic state transitions of the two Lua scripts;
// this is an isolated logic test, NOT a real Redis/Upstash integration test.
class FakeRedis {
  constructor(){this.kv=new Map();this.sorted=new Map();this.evals=0;this.injectError=false;}
  z(name){if(!this.sorted.has(name))this.sorted.set(name,new Map());return this.sorted.get(name);}
  put(id,body=validBody(),attempts=0,due=NOW){
    this.kv.set('affareradar:queue:item:'+id,JSON.stringify({body,dealId:id,attempts,dueAt:due}));
    this.z('affareradar:queue').set(id,due);
  }
  has(id){return this.z('affareradar:queue').has(id)}
  get(id){let x=this.kv.get('affareradar:queue:item:'+id);return x?JSON.parse(x):null;}
  async cmd(command,...args){
    if(this.injectError)throw Error('synthetic_redis_failure');
    if(command==='ZRANGEBYSCORE'){
      const [queue,,max,,offset,limit]=args;
      const entries=[...this.z(queue)].filter(([_,s])=>s<=Number(max)).sort((a,b)=>a[1]-b[1]);
      return {configured:true,result:entries.slice(Number(offset),Number(offset)+Number(limit)).map(([id])=>id)};
    }
    assert.equal(command,'EVAL');this.evals++;
    const [script,n,...rest]=args;
    const k=rest.slice(0,Number(n));const argv=rest.slice(Number(n));
    const [queue,item,lease,journal,review,dlq,reviewItem,deadItem]=k;
    const [id,token]=[argv[0],argv[2]];
    if(script===CLAIM_LUA){
      const due=this.z(queue).get(id);const now=Number(argv[1]);
      if(due===undefined||due>now)return {configured:true,result:['NOT_DUE']};
      const raw=this.kv.get(item);
      if(raw===undefined){this.z(review).set(id,now);this.z(queue).delete(id);return {configured:true,result:['ORPHAN_REVIEW']};}
      if(this.kv.has(lease))return {configured:true,result:['LOCKED']};
      if(this.kv.has(journal)){
        this.kv.set(k[5],raw);this.z(review).set(id,now);this.z(queue).delete(id);this.kv.delete(item);
        return {configured:true,result:['UNCERTAIN_REVIEW']};
      }
      this.kv.set(lease,token);this.kv.set(journal,token);
      return {configured:true,result:['CLAIMED',raw]};
    }
    assert.equal(script,FINALIZE_LUA);
    const [deal,leaseToken,previous,action,now,backoff,next]=argv;
    if(this.kv.get(lease)!==leaseToken||this.kv.get(journal)!==leaseToken)return {configured:true,result:'STALE_LEASE'};
    const current=this.kv.get(item);
    if(action==='UPSTREAM_QUEUED'&&current!==undefined&&current!==previous){
      this.kv.delete(journal);this.kv.delete(lease);return {configured:true,result:'REQUEUED_BY_UPSTREAM'};
    }
    if(current===undefined||current!==previous){
      this.kv.set(reviewItem,JSON.stringify({previous,current:current??null,reason:'payload_changed_or_missing'}));
      this.z(review).set(deal,Number(now));this.z(queue).delete(deal);this.kv.delete(item);
      this.kv.set(journal,'review:payload_changed_or_missing');this.kv.delete(lease);
      return {configured:true,result:'CONFLICT_REVIEW'};
    }
    if(action==='ACK'){
      this.z(queue).delete(deal);this.kv.delete(item);this.kv.delete(journal);this.kv.delete(lease);
      return {configured:true,result:'ACKED'};
    }
    if(action==='RETRY'){
      this.kv.set(item,next);this.z(queue).set(deal,Number(backoff));
      this.kv.delete(journal);this.kv.delete(lease);return {configured:true,result:'REQUEUED'};
    }
    if(action==='DLQ'){
      this.kv.set(deadItem,next);this.z(dlq).set(deal,Number(now));this.z(queue).delete(deal);this.kv.delete(item);
      this.kv.delete(journal);this.kv.delete(lease);return {configured:true,result:'DEAD_LETTER'};
    }
    this.kv.set(reviewItem,current);this.z(review).set(deal,Number(now));this.z(queue).delete(deal);this.kv.delete(item);
    this.kv.set(journal,'review:'+argv[8]);this.kv.delete(lease);
    return {configured:true,result:'MANUAL_REVIEW'};
  }
}
function engine(db,id,publish,other={}){
  return processDueItem({redisCommand:db.cmd.bind(db),publish,dealId:id,now:NOW,...other});
}
const published=async()=>({status:200,data:{ok:true,published:true,telegram_message_id:113}});
const rejected=async()=>({status:200,data:{ok:true,published:false,decision:'rejected',reason:'policy_blocked'}});

test('confirmed Telegram delivery is acknowledged only after downstream response', async()=>{
  const db=new FakeRedis();db.put('A');let sawQueued=false;
  const result=await engine(db,'A',async()=>{sawQueued=db.has('A');return published();});
  assert.equal(sawQueued,true);assert.equal(result.status,'acked');
  assert.equal(db.has('A'),false);assert.equal(db.get('A'),null);
  assert.equal(db.kv.has('affareradar:queue:journal:A'),false);
});
test('terminal policy rejection safely acknowledges, without retry',async()=>{
  const db=new FakeRedis();db.put('B');let calls=0;
  const r=await engine(db,'B',async()=>{calls++;return rejected();});
  assert.equal(r.status,'acked');assert.equal(calls,1);assert.equal(db.has('B'),false);
});
test('pre-send unavailability is retried with bounded backoff and persisted attempts',async()=>{
  const db=new FakeRedis();db.put('C');
  const r=await engine(db,'C',async()=>({status:500,data:{ok:false,error:'host_missing'}}));
  assert.equal(r.status,'retry_scheduled');assert.equal(db.get('C').attempts,1);
  assert.equal(db.z('affareradar:queue').get('C'),NOW+60000);
  assert.equal(db.kv.has('affareradar:queue:journal:C'),false);
});
test('pre-send retriable errors are DLQed after max attempts',async()=>{
  const db=new FakeRedis();db.put('C2',validBody(),2);
  const r=await engine(db,'C2',async()=>({status:401,data:{ok:false,error:'unauthorized'}}),{maxAttempts:3});
  assert.equal(r.status,'dead_letter');assert.equal(db.has('C2'),false);
  assert.equal(db.z('affareradar:queue:dead_letter').has('C2'),true);
});
test('ambiguous HTTP 502, response body unknown, and transport failure all require human review',async()=>{
  for(const scenario of [
    async()=>({status:502,data:{ok:false,error:'telegram_publish_failed'}}),
    async()=>({status:502,data:null}),
    async()=>{throw Error('synthetic_timeout')},
    async()=>({status:503,data:{ok:false,error:'gateway_failure'}})
  ]){
    const db=new FakeRedis();db.put('D');
    const r=await engine(db,'D',scenario);
    assert.equal(r.status,'review');assert.equal(db.has('D'),false);
    assert.equal(db.get('D'),null);assert.ok(db.kv.has('affareradar:queue:review:item:D'));assert.equal(db.z('affareradar:queue:review').has('D'),true);
  }
});
test('stale price and unverified coupon cannot be published',async()=>{
  for(const body of [
    validBody({verifiedAt:new Date(NOW-20*60000).toISOString()}),
    validBody({coupon:'10%',couponVerified:false}),
    validBody({priceVerified:false}),
    validBody({promotionTimeLimited:true,promotionValidUntil:new Date(NOW-1000).toISOString()})
  ]){
    const db=new FakeRedis();db.put('E',body);let sent=0;
    const r=await engine(db,'E',async()=>{sent++;return published();});
    assert.equal(sent,0);assert.equal(r.status,'dead_letter');
    assert.ok(db.z('affareradar:queue:dead_letter').has('E'));
  }
});
test('concurrent processors cannot claim the same deal while lease active',async()=>{
  const db=new FakeRedis();db.put('F');let proceed;let sends=0;
  const first=engine(db,'F',async()=>{sends++;await new Promise(resolve=>{proceed=resolve;});return published();});
  // Wait for the synthetic downstream call to start, after an atomic claim.
  for(let i=0;i<30&&!proceed;i++)await Promise.resolve();
  assert.equal(typeof proceed,'function');
  const second=await engine(db,'F',async()=>{sends++;return published();});
  assert.equal(second.status,'locked');
  proceed();assert.equal((await first).status,'acked');assert.equal(sends,1);
});
test('crash after durable claim is quarantined on next poll, not re-sent',async()=>{
  const db=new FakeRedis();db.put('G');const id='G';
  const k=['affareradar:queue','affareradar:queue:item:G','affareradar:queue:lease:G','affareradar:queue:journal:G','affareradar:queue:review','affareradar:queue:review:item:G'];
  await db.cmd('EVAL',CLAIM_LUA,6,...k,id,String(NOW),'synthetic_crashed_worker',180,1209600);
  db.kv.delete('affareradar:queue:lease:G'); // expiry, journal persists
  let sends=0;const r=await engine(db,id,async()=>{sends++;return published();});
  assert.equal(r.status,'uncertain_review');assert.equal(sends,0);
  assert.equal(db.z('affareradar:queue:review').has(id),true);
  assert.equal(db.get(id),null);assert.ok(db.kv.has('affareradar:queue:review:item:G'));
});
test('upstream requeue with changed stored payload preserves newly scheduled item',async()=>{
  const db=new FakeRedis();db.put('H');
  const r=await engine(db,'H',async()=>{
    db.put('H',validBody({price:'21.00'}),0,NOW+3600000);
    return {status:200,data:{ok:true,published:false,decision:'queued',queue:{queued:true,mode:'persistent_upstash_redis'}}};
  });
  assert.equal(r.status,'upstream_queued');assert.equal(db.has('H'),true);
  assert.equal(db.get('H').body.price,'21.00');
});
test('upstream reports queued but did not persist a new item: review instead of destructive ack',async()=>{
  const db=new FakeRedis();db.put('I');
  const r=await engine(db,'I',async()=>({status:200,data:{ok:true,published:false,decision:'queued'}}));
  assert.equal(r.status,'review');assert.equal(db.has('I'),false);
  assert.ok(db.z('affareradar:queue:review').has('I'));
});
test('concurrent changed item during publish is quarantined without deleting replacement payload',async()=>{
  const db=new FakeRedis();db.put('J');
  const r=await engine(db,'J',async()=>{db.put('J',validBody({price:'19.00'}));return published();});
  assert.equal(r.status,'review');assert.equal(JSON.parse(db.kv.get('affareradar:queue:review:item:J')).current.includes('19.00'),true);
  assert.equal(db.z('affareradar:queue:review').has('J'),true);
});
test('orphan queued index is quarantined',async()=>{
  const db=new FakeRedis();db.z('affareradar:queue').set('K',NOW);
  const r=await engine(db,'K',published);
  assert.equal(r.status,'orphan_review');assert.equal(db.has('K'),false);
});
test('attempt cap reached before send is moved to dead letter',async()=>{
  const db=new FakeRedis();db.put('L',validBody(),5);let calls=0;
  const r=await engine(db,'L',async()=>{calls++;return published();});
  assert.equal(r.status,'dead_letter');assert.equal(calls,0);
});
test('processor returns non-success when manual review is needed',async()=>{
  const db=new FakeRedis();db.put('M');
  const out=await processQueueBatch({redisCommand:db.cmd.bind(db),publish:async()=>{throw Error('time_out');},now:NOW});
  assert.equal(out.ok,false);assert.equal(out.counts.review,1);
});
test('empty queue reports a no-op and never dispatches',async()=>{
  const db=new FakeRedis();let dispatched=0;
  const out=await processQueueBatch({redisCommand:db.cmd.bind(db),publish:async()=>{dispatched++},now:NOW});
  assert.equal(dispatched,0);assert.equal(out.processed,0);assert.equal(out.ok,true);
});
test('retry delay is monotonic and bounded at one hour',()=>{
  const t=[1,2,3,4,5,6,7,8,9,100].map(retryDelayMs);
  for(let i=1;i<t.length;i++)assert.ok(t[i]>=t[i-1]);
  assert.equal(t.at(-1),3600000);
});
test('classifier does not conflate HTTP success with publication success',()=>{
  assert.equal(classifyPublishResponse({status:200,data:{ok:true,published:false,decision:'rejected'}}).kind,'ACK');
  assert.equal(classifyPublishResponse({status:200,data:{ok:true,published:true}}).kind,'REVIEW');
  assert.equal(classifyPublishResponse({status:502,data:{ok:false,error:'telegram_publish_failed'}}).kind,'REVIEW');
});
test('dead-letter payload is preserved in dedicated archive, not active queue key',async()=>{
  const db=new FakeRedis();db.put('N',validBody({priceVerified:false}));
  const r=await engine(db,'N',published);
  assert.equal(r.status,'dead_letter');
  assert.equal(db.kv.has('affareradar:queue:item:N'),false);
  const archive=db.kv.get('affareradar:queue:dead:item:N');
  assert.ok(archive);assert.ok(JSON.parse(archive).validationCodes.includes('PRICE_NOT_VERIFIED'));
});
test('Redis outage before claim cannot cause a publication',async()=>{
  const db=new FakeRedis();db.put('O');db.injectError=true;let sent=0;
  await assert.rejects(engine(db,'O',async()=>{sent++;return published();}),/synthetic_redis_failure/);
  assert.equal(sent,0);assert.equal(db.has('O'),true);
});
test('invalid attempt limit is treated as safe default, not unlimited',async()=>{
  const db=new FakeRedis();db.put('P',validBody(),5);let sent=0;
  const r=await engine(db,'P',async()=>{sent++;return published();},{maxAttempts:NaN});
  assert.equal(r.status,'dead_letter');assert.equal(sent,0);
});
test('Redis failure after Telegram confirmation cannot silently auto-republish',async()=>{
  const db=new FakeRedis();db.put('Q');let sends=0;
  await assert.rejects(engine(db,'Q',async()=>{sends++;db.injectError=true;return published();}),/synthetic_redis_failure/);
  db.injectError=false;
  db.kv.delete('affareradar:queue:lease:Q'); // lease expiry after a crashed finalize
  const next=await engine(db,'Q',async()=>{sends++;return published();});
  assert.equal(next.status,'uncertain_review');assert.equal(sends,1);
  assert.equal(db.z('affareradar:queue:review').has('Q'),true);
  assert.ok(db.kv.has('affareradar:queue:review:item:Q'));
});
