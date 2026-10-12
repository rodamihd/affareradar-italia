import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Execute the actual endpoint handler with module dependencies replaced by inert
// test doubles. No network, Redis, Telegram, or paid provider calls are allowed.
const source = fs.readFileSync(new URL("../api/auto-publish.js", import.meta.url), "utf8");
const imports = [...source.matchAll(/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];/g)];
const forbidden = [];
const mock = (name) => {
  if (name === "startRuntimeObservation") return () => ({});
  if (name === "transformExternalEditorial") return (body) => ({body});
  if (name === "sanitizeForAmazonPublication") return (body) => ({body});
  if (name === "publicationRoute") return (body) =>
    body.pricelessSignal === true || body.commercialClaimsSuppressed === true
      ? "EDITORIAL_HUMAN_REVIEW" : "COMMERCIAL_STRICT";
  return () => { throw new Error("Unexpected dependency call: " + name); };
};
const context = vm.createContext({
  console,
  process:{env:{PUBLISH_SECRET:"synthetic-only-secret"}},
  Date,
  URL,
  Buffer,
  setTimeout:() => {throw Error("Unexpected timer");},
  fetch:async (...args) => { forbidden.push(args); throw Error("Network forbidden"); },
  globalThis:{}
});
const module = new vm.SourceTextModule(source,{context,identifier:"api/auto-publish.js"});
const caches = new Map();
await module.link(async (specifier) => {
  if (caches.has(specifier)) return caches.get(specifier);
  const statement = imports.find((match) => match[2] === specifier);
  assert.ok(statement, "Unknown import " + specifier);
  const binding = statement[1].trim();
  const names = [];
  if (binding.startsWith("{")) {
    for (const entry of binding.replace(/[{}]/g,"").split(",")) {
      const name = entry.trim().split(/\s+as\s+/).at(-1).trim();
      if (name) names.push(name);
    }
  } else if (binding.startsWith("* as ")) {
    throw Error("Unexpected namespace import");
  } else {
    names.push("default");
  }
  const dependency = new vm.SyntheticModule(names, function() {
    for (const name of names) this.setExport(name, name === "default" ? {} : mock(name));
  }, {context,identifier:specifier});
  caches.set(specifier,dependency);
  return dependency;
});
await module.evaluate();
const handler = module.namespace.default;
async function invoke(body, {method="POST",secret="synthetic-only-secret"}={}) {
  let status = null, data = null;
  const req = {method,headers:{"x-affareradar-secret":secret},body};
  const res = {status(code){status=code;return this;},json(value){data=value;return this;}};
  await handler(req,res);
  return {status,data};
}
assert.equal((await invoke({}, {method:"GET"})).status,405);
assert.equal((await invoke({}, {secret:"wrong"})).status,401);
for (const fixture of [
  {pricelessSignal:true,humanApprovedPricelessSignal:true,asin:"B012345678"},
  {commercialClaimsSuppressed:true,priceVerified:true,asin:"B012345678"}
]) {
  const result = await invoke(fixture);
  assert.equal(result.status,200);
  assert.equal(result.data.published,false);
  assert.equal(result.data.decision,"review_required");
  assert.equal(result.data.reason,"editorial_human_review_required");
}
assert.deepEqual(forbidden,[]);
console.log("isolated auto-publish endpoint guard test passed");
