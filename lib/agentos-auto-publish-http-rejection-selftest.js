import assert from "node:assert/strict";
import handler from "../api/auto-publish.js";
// Only test early rejection paths. Never use a valid publisher secret with
// an approval that can authorize publication, and never call external APIs.
const beforeSecret=process.env.PUBLISH_SECRET;
const beforeGate=process.env.AGENTOS_GOVERNANCE_ENFORCE;
process.env.PUBLISH_SECRET="ci-synthetic-publisher-secret";
process.env.AGENTOS_GOVERNANCE_ENFORCE="true";
const response=()=>{
 const out={code:200,body:null};
 return {out,status(n){out.code=n;return this;},json(body){out.body=body;return this;}};
};
try {
 let r=response();
 await handler({method:"GET",headers:{},body:{}},r);
 assert.equal(r.out.code,405);
 r=response();
 await handler({method:"POST",headers:{},body:{}},r);
 assert.equal(r.out.code,401);
 r=response();
 await handler({method:"POST",headers:{"x-affareradar-secret":"ci-synthetic-publisher-secret"},body:{}},r);
 assert.equal(r.out.code,403);
 assert.equal(r.out.body?.error,"governance_approval_required");
 r=response();
 await handler({method:"POST",headers:{"x-affareradar-secret":"ci-synthetic-publisher-secret","x-agentos-approval-id":"invalid-synthetic-approval"},body:{}},r);
 assert.equal(r.out.code,403);
 console.log("HTTP rejection paths verified; no publication calls executed");
} finally {
 if(beforeSecret===undefined)delete process.env.PUBLISH_SECRET;else process.env.PUBLISH_SECRET=beforeSecret;
 if(beforeGate===undefined)delete process.env.AGENTOS_GOVERNANCE_ENFORCE;else process.env.AGENTOS_GOVERNANCE_ENFORCE=beforeGate;
}
