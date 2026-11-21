import assert from "node:assert/strict";
import {makeSupabaseReviewerAuthenticator} from "./agentos-supabase-reviewer-composition.js";
const user="00000000-0000-4000-8000-000000000001",digest="a".repeat(64);
const claims={sub:user,aal:"aal2",session_id:"session-1",exp:Math.floor(Date.now()/1000)+600,iat:Math.floor(Date.now()/1000)-60};
const token="eyJhbGciOiJIUzI1NiJ9."+Buffer.from(JSON.stringify(claims)).toString("base64url")+".test";
const opts={supabaseUrl:"https://example.supabase.co",publishableKey:"public-test",fetchImpl:async()=>({ok:true,json:async()=>({id:user})}),checkActiveSession:async()=>true,
 queryPrivateReviewerGrant:async()=>[{reviewer_id:user,scope:"affareradar",active:true,can_approve_publish:true}],
 verifyExplicitApproval:async()=>true};
const ctx={operation:"PUBLISH_OFFER",scope:"affareradar",publicationDigest:digest};
assert.equal((await makeSupabaseReviewerAuthenticator(opts)({accessToken:token},ctx))?.id,user);
for(const invalid of [
 {...opts,queryPrivateReviewerGrant:async()=>[]},
 {...opts,queryPrivateReviewerGrant:async()=>[{reviewer_id:user,scope:"affareradar",active:false,can_approve_publish:true}]},
 {...opts,queryPrivateReviewerGrant:async()=>[{reviewer_id:user,scope:"affareradar",active:true,can_approve_publish:false}]},
 {...opts,queryPrivateReviewerGrant:async()=>[{reviewer_id:"different",scope:"affareradar",active:true,can_approve_publish:true}]},
 {...opts,checkActiveSession:async()=>false},
 {...opts,verifyExplicitApproval:async()=>false}
])assert.equal(await makeSupabaseReviewerAuthenticator(invalid)({accessToken:token},ctx),null);
console.log("Supabase reviewer composition synthetic tests passed");
