import assert from "node:assert/strict";
import {checkAgentosStagingDb} from "./agentos-staging-db-readiness.js";
const ok={query:async(sql)=>sql.includes("current_database()")?{rows:[{database_name:"postgres",role_name:"agentos_readonly"}]}:{rows:[{schema_usage:true,can_read:true,can_mutate:false}]}};
assert.deepEqual(await checkAgentosStagingDb({db:ok,expectedDatabase:"postgres"}),{ready:true,reason:"read_only_role_verified"});
assert.equal((await checkAgentosStagingDb({db:ok,expectedDatabase:"other"})).ready,false);
for(const rights of [{schema_usage:false,can_read:true,can_mutate:false},{schema_usage:true,can_read:false,can_mutate:false},{schema_usage:true,can_read:true,can_mutate:true}]) {
const db={query:async(sql)=>sql.includes("current_database()")?{rows:[{database_name:"postgres",role_name:"agentos_readonly"}]}:{rows:[rights]}};
assert.equal((await checkAgentosStagingDb({db,expectedDatabase:"postgres"})).ready,false);
}
assert.equal((await checkAgentosStagingDb({db:{query:async()=>{throw Error("offline")}},expectedDatabase:"postgres"})).ready,false);
console.log("staging db readiness synthetic checks passed");
