import assert from "node:assert/strict";
import { issueApproval } from "./agentos-approval-issuer.js";
import { consumeRedisApproval } from "./agentos-approval-redis-store.js";
import { verifyStoredApproval } from "./agentos-approval-verifier.js";
import { publicationRequestDigest } from "./agentos-publication-binding.js";
import { evaluateAgentAuthorization } from "./agentos-governance-gate.js";
// Synthetic stateful Redis model. This is not a real Redis integration test.
const originalUrl=process.env.UPSTASH_REDIS_REST_URL;
const originalToken=process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.UPSTASH_REDIS_REST_URL="https://example.invalid";
process.env.UPSTASH_REDIS_REST_TOKEN="synthetic-only";
const records=new Map();
const command=async(op,...args)=>{
  if(op==="SET"){
    const [key,json,,,nx]=args;
    if(nx!=="NX" || records.has(key)) return {configured:true,result:null};
    records.set(key,JSON.parse(json));return {configured:true,result:"OK"};
  }
  if(op==="EVAL"){
    const [,count,key,id,principal,operation,scope,time,digest]=args;
    assert.equal(count,1);
    const record=records.get(key);
    if(!record || record.id!==id || record.principal!==principal || record.operation!==operation || record.scope!==scope || record.publicationDigest!==digest ||
       record.revoked || record.assurance!=="HUMAN_VERIFIED" || record.expiresAtMs<=Number(time)) return {configured:true,result:null};
    records.delete(key);
    return {configured:true,result:JSON.stringify(record)};
  }
  throw Error("unexpected command");
};
const publicationBody={asin:"TEST-OFFER",price:12.5};
const publicationDigest=publicationRequestDigest(publicationBody);
const context={principal:"affareradar-auto-publish",operation:"PUBLISH_OFFER",scope:"affareradar"};
try {
  const issued=await issueApproval({request:{...context,publicationBody},authenticationContext:{},authenticateReviewer:async()=>({
    id:"reviewer-test",verified:true,canApprove:true,authenticationStrength:"STRONG"
  }),command,now:1000000000000,generateId:()=>"approval_test_123456789012"});
  assert.equal(issued.issued,true);
  const consume=(p)=>consumeRedisApproval({...p,command});
  const verified=await verifyStoredApproval({approvalId:issued.id,...context,publicationDigest,now:1000000001000,consume});
  assert.equal(verified.verified,true);
  const decision=evaluateAgentAuthorization({...context,grantScope:context.scope,grantedPermissions:["PUBLISH_OFFER"],trustedApproval:verified.verified});
  assert.equal(decision.decision,"ALLOW");
  assert.equal((await verifyStoredApproval({approvalId:issued.id,...context,now:1000000002000,consume})).verified,false);
  assert.equal(evaluateAgentAuthorization({...context,grantScope:context.scope,grantedPermissions:["PUBLISH_OFFER"],trustedApproval:false}).decision,"REQUIRE_HUMAN_APPROVAL");
} finally {
  if(originalUrl===undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL=originalUrl;
  if(originalToken===undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN=originalToken;
}
console.log("synthetic approval issue-consume-governance cycle passed");
