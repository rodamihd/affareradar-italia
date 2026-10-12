import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { issueApproval } from "./agentos-approval-issuer.js";
import { consumeRedisApproval } from "./agentos-approval-redis-store.js";
import { verifyStoredApproval } from "./agentos-approval-verifier.js";

const exec = promisify(execFile);
const originalUrl=process.env.UPSTASH_REDIS_REST_URL;
const originalToken=process.env.UPSTASH_REDIS_REST_TOKEN;
// Configuration is synthetic: all data operations go ONLY to loopback Redis.
process.env.UPSTASH_REDIS_REST_URL="https://example.invalid";
process.env.UPSTASH_REDIS_REST_TOKEN="synthetic";
const command=async (name,...args)=>{
  const {stdout}=await exec("redis-cli",["-h","127.0.0.1","-p","6379","--raw",name,...args.map(String)],{timeout:5000});
  const result=stdout.trim();
  return {configured:true,result:result||null};
};
const request={principal:"affareradar-ci-agent",operation:"PUBLISH_OFFER",scope:"affareradar"};
const authenticateReviewer=async()=>({id:"ci-reviewer",verified:true,canApprove:true,authenticationStrength:"STRONG"});
const now=Date.now();
try {
  const issued=await issueApproval({request,authenticationContext:{},authenticateReviewer,command,now,generateId:()=>("test_"+crypto.randomUUID().replaceAll("-",""))});
  assert.equal(issued.issued,true,`approval issuance failed: ${issued.reason}`);
  const consume=p=>consumeRedisApproval({...p,command});
  const params={approvalId:issued.id,...request,now:now+1000,consume};
  const two=await Promise.all([verifyStoredApproval(params),verifyStoredApproval(params)]);
  assert.equal(two.filter(x=>x.verified).length,1,"only one concurrent consumer may succeed");
  assert.equal((await verifyStoredApproval(params)).verified,false,"replay denied");
  const second=await issueApproval({request,authenticationContext:{},authenticateReviewer,command,now,generateId:()=>("test_"+crypto.randomUUID().replaceAll("-",""))});
  assert.equal(second.issued,true,`second issuance failed: ${second.reason}`);
  assert.equal((await verifyStoredApproval({...params,approvalId:second.id,scope:"quotai"})).verified,false,"wrong scope denied");
  assert.equal((await verifyStoredApproval({...params,approvalId:second.id,now:now+400000})).verified,false,"expired approval denied");
  console.log("isolated Redis EVAL atomic consumption checks passed");
} finally {
  if(originalUrl===undefined)delete process.env.UPSTASH_REDIS_REST_URL;else process.env.UPSTASH_REDIS_REST_URL=originalUrl;
  if(originalToken===undefined)delete process.env.UPSTASH_REDIS_REST_TOKEN;else process.env.UPSTASH_REDIS_REST_TOKEN=originalToken;
}
