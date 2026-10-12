import assert from "node:assert/strict";
import {makePrivateReviewerGrantLookup} from "./agentos-private-reviewer-grant-lookup.js";
const reviewerId="00000000-0000-4000-8000-000000000001";
let calls=0;
const lookup=makePrivateReviewerGrantLookup({db:{query:async(sql,values)=>{
  calls++;assert.match(sql,/\$1::uuid and scope = \$2/);
  assert.deepEqual(values,[reviewerId,"affareradar"]);
  return {rows:[{reviewer_id:reviewerId,scope:"affareradar",active:true,can_approve_publish:true}]};
}}});
assert.equal((await lookup({reviewerId,scope:"affareradar"})).length,1);
assert.deepEqual(await lookup({reviewerId:"not-uuid",scope:"affareradar"}),[]);
assert.deepEqual(await lookup({reviewerId,scope:"quotai"}),[]);
assert.equal(calls,1);
const broken=makePrivateReviewerGrantLookup({db:{query:async()=>{throw Error("offline");}}});
assert.deepEqual(await broken({reviewerId,scope:"affareradar"}),[]);
console.log("private reviewer grant lookup synthetic tests passed");
