import assert from "node:assert/strict";
import {checkAgentosStagingDb} from "./agentos-staging-db-readiness.js";
function fixture({policy=true,write=false,login=true,superuser=false,bypass=false}={}) {
  return {query:async(sql)=>{
    if(sql.includes("current_database()")) return {rows:[{database_name:"postgres",role_name:"agentos_backend_staging"}]};
    if(sql.includes("has_schema_privilege")) return {rows:[{schema_usage:true,can_read:true,can_mutate:write}]};
    if(sql.includes("pg_policies")) return {rows:policy?[{policyname:"reviewer_reader_staging_select"}]:[]};
    if(sql.includes("pg_roles")) return {rows:[{rolcanlogin:login,rolsuper:superuser,rolbypassrls:bypass}]};
    throw new Error("unexpected_query");
  }};
}
assert.equal((await checkAgentosStagingDb({db:fixture(),expectedDatabase:"postgres"})).ready,true);
for(const config of [{policy:false},{write:true},{login:false},{superuser:true},{bypass:true}]) {
 assert.equal((await checkAgentosStagingDb({db:fixture(config),expectedDatabase:"postgres"})).ready,false);
}
assert.equal((await checkAgentosStagingDb({db:fixture(),expectedDatabase:"wrong"})).ready,false);
assert.equal((await checkAgentosStagingDb({db:{query:async()=>{throw Error("offline")}},expectedDatabase:"postgres"})).ready,false);
console.log("staging DB policy-aware readiness synthetic checks passed");
