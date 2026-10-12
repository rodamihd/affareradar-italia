import assert from "node:assert/strict";
import { consumeRedisApproval } from "./agentos-approval-redis-store.js";
const base={publicationDigest:"a".repeat(64),approvalId:"approval_1234567890123456",principal:"affareradar-auto-publish",operation:"PUBLISH_OFFER",scope:"affareradar",now:1791806400000};
const good={publicationDigest:base.publicationDigest,id:base.approvalId,principal:base.principal,operation:base.operation,scope:base.scope,expiresAtMs:base.now+60000,approvedBy:"reviewer-1",assurance:"HUMAN_VERIFIED"};
let calls=0;
const mock=async (command,script,nkeys,key,...args)=>{calls++;assert.equal(command,"EVAL");assert.equal(nkeys,1);assert.ok(key.startsWith("agentos:approval:v1:"));assert.deepEqual(args.slice(0,4),[base.approvalId,base.principal,base.operation,base.scope]);return {configured:true,result:JSON.stringify(good)}};
const prevUrl=process.env.UPSTASH_REDIS_REST_URL;
const prevToken=process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.UPSTASH_REDIS_REST_URL="https://example.invalid";
process.env.UPSTASH_REDIS_REST_TOKEN="synthetic-only";
try {
  const a=await consumeRedisApproval({...base,command:mock});
  assert.equal(a?.atomic,true);
  assert.equal(a?.consumed,true);
  assert.equal(calls,1);
  assert.equal(await consumeRedisApproval({...base,approvalId:"../invalid",command:mock}),null);
  assert.equal(await consumeRedisApproval({...base,command:async()=>({configured:true,result:null})}),null);
  assert.equal(await consumeRedisApproval({...base,command:async()=>({configured:false,result:JSON.stringify(good)})}),null);
} finally {
 if(prevUrl===undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL=prevUrl;
 if(prevToken===undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN=prevToken;
}
console.log("redis approval adapter synthetic tests passed");
