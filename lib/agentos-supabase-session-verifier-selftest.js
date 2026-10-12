import assert from "node:assert/strict";
import {makeSupabaseSessionVerifier} from "./agentos-supabase-session-verifier.js";
const user="00000000-0000-4000-8000-000000000001";
const claims={sub:user,aal:"aal2",session_id:"session-1",exp:Math.floor(Date.now()/1000)+600,iat:Math.floor(Date.now()/1000)-60};
const token=(c)=>"eyJhbGciOiJIUzI1NiJ9."+Buffer.from(JSON.stringify(c)).toString("base64url")+".signature";
const settings={supabaseUrl:"https://example.supabase.co",publishableKey:"example-public-key",
fetchImpl:async()=>({ok:true,json:async()=>({id:user})}),checkActiveSession:async()=>true};
assert.equal((await makeSupabaseSessionVerifier(settings)({accessToken:token(claims)})).mfaLevel,"aal2");
for(const x of [{...claims,aal:"aal1"},{...claims,exp:1},{...claims,session_id:null},{...claims,sub:"other"},{...claims,is_anonymous:true}])
 assert.equal(await makeSupabaseSessionVerifier(settings)({accessToken:token(x)}),null);
assert.equal(await makeSupabaseSessionVerifier({...settings,fetchImpl:async()=>({ok:false})})({accessToken:token(claims)}),null);
assert.equal(await makeSupabaseSessionVerifier({...settings,checkActiveSession:async()=>false})({accessToken:token(claims)}),null);
assert.equal(await makeSupabaseSessionVerifier({...settings,fetchImpl:async()=>{throw Error("offline")}})({accessToken:token(claims)}),null);
console.log("Supabase session verifier synthetic negative checks passed");
