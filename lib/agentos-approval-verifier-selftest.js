import assert from "node:assert/strict";
import { verifyStoredApproval as verify } from "./agentos-approval-verifier.js";
const now=Date.parse("2026-10-12T12:00:00Z");
const digest="a".repeat(64);
const args={publicationDigest:digest,approvalId:"test-1",principal:"affareradar-auto-publish",operation:"PUBLISH_OFFER",scope:"affareradar",now};
const record={publicationDigest:digest,id:"test-1",principal:args.principal,operation:args.operation,scope:args.scope,consumed:true,atomic:true,revoked:false,expiresAt:"2026-10-12T12:01:00Z",approvedBy:"human-reviewer",assurance:"HUMAN_VERIFIED"};
assert.equal((await verify(args)).verified,false);
assert.equal((await verify({...args,consume:async()=>record})).verified,true);
for (const mutation of [{atomic:false},{consumed:false},{scope:"quotai"},{publicationDigest:"b".repeat(64)},{revoked:true},{expiresAt:"2026-10-12T11:59:00Z"},{approvedBy:args.principal},{assurance:"SELF_REPORTED"}]) {
 assert.equal((await verify({...args,consume:async()=>({...record,...mutation})})).verified,false);
}
assert.equal((await verify({...args,consume:async()=>{throw Error("offline")}})).verified,false);
console.log("approval verifier contract tests passed");
