import assert from "node:assert/strict";
import { issueApproval } from "./agentos-approval-issuer.js";
import { publicationRequestDigest } from "./agentos-publication-binding.js";
const req={principal:"affareradar-agent",operation:"PUBLISH_OFFER",scope:"affareradar",publicationBody:{asin:"TEST1"}};
const reviewer=async()=>({id:"reviewer-1",verified:true,canApprove:true,authenticationStrength:"STRONG",explicitApproval:true,approvedDigest:"a".repeat(64)});
const input={request:req,authenticateReviewer:reviewer,authenticationContext:{},now:1791806400000};
assert.equal((await issueApproval(input)).issued,false);
assert.equal((await issueApproval({...input,authenticateReviewer:async()=>{throw Error("not authorized")}})).issued,false);
assert.equal((await issueApproval({...input,request:{...req,scope:"quotai"}})).issued,false);
assert.equal((await issueApproval({...input,ttlSeconds:999})).issued,false);
console.log("issuer fail closed checks passed");

// A reviewer must explicitly approve the exact offer, not merely hold a role.
const validDigest=publicationRequestDigest(req.publicationBody);
const denied=await issueApproval({...input,
 authenticateReviewer:async()=>({id:"reviewer-1",verified:true,canApprove:true,authenticationStrength:"STRONG",explicitApproval:true,approvedDigest:"f".repeat(64)})});
assert.equal(denied.issued,false);
assert.equal(validDigest.length,64);
