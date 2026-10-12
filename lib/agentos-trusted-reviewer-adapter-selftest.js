import assert from "node:assert/strict";
import { makeTrustedReviewerAuthenticator } from "./agentos-trusted-reviewer-adapter.js";
const digest="a".repeat(64);
const valid={verifySession:async()=>({verified:true,userId:"reviewer-123",mfaLevel:"aal2",sessionActive:true}),
 lookupReviewerGrant:async()=>({active:true,canApprove:true}),
 verifyExplicitApproval:async(_,ctx)=>ctx.publicationDigest===digest};
const context={operation:"PUBLISH_OFFER",scope:"affareradar",publicationDigest:digest};
const approved=await makeTrustedReviewerAuthenticator(valid)({},context);
assert.equal(approved.explicitApproval,true);
assert.equal(approved.approvedDigest,digest);
for(const different of [
 {...valid,verifySession:async()=>({verified:true,userId:"reviewer-123",mfaLevel:"aal1",sessionActive:true})},
 {...valid,verifySession:async()=>({verified:false,userId:"reviewer-123",mfaLevel:"aal2",sessionActive:true})},
 {...valid,lookupReviewerGrant:async()=>({active:false,canApprove:true})},
 {...valid,verifyExplicitApproval:async()=>false},
 {...valid,verifySession:async()=>{throw Error("offline")}}
])assert.equal(await makeTrustedReviewerAuthenticator(different)({},context),null);
assert.equal(await makeTrustedReviewerAuthenticator(valid)({},{...context,scope:"quotai"}),null);
console.log("trusted reviewer adapter synthetic checks passed");
