import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Execute the actual endpoint handler with module dependencies replaced by inert
// test doubles. No network, Redis, Telegram, or paid provider calls are allowed.
const source = fs.readFileSync(new URL("../api/auto-publish.js", import.meta.url), "utf8");
const imports = [...source.matchAll(/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];/g)];
const forbidden = [];
const validationCalls = [];
let validatorModule;
const stubs = {
  startRuntimeObservation:() => ({}),
  transformExternalEditorial:(body) => ({body}),
  sanitizeForAmazonPublication:(body) => ({body}),
  redisConfig:() => null,
  redisCommand:async () => ({configured:false,result:null}),
  learnedOutcomeProfile:() => ({}),
  mergeLearnedSignals:(body) => body,
  evaluateOriginality:() => ({passed:true}),
  resolveSignalIntent:() => ({intent:"deal"}),
  initialSourceReputation:() => ({score:90,status:"HEALTHY"}),
  evaluateAmazonReward:() => ({isReward:false,eligible:false}),
  evaluateTrafficSource:() => ({passed:true}),
  evaluateRepetition:() => ({passed:true}),
  creatorQualityScore:() => ({passed:true}),
  publishingWindow:() => ({}),
  evaluateAmazonVerification:() => ({state:"VERIFIED"}),
  evaluatePolicies:() => ({blocking:[]}),
  expectedRevenue:() => ({commissionPotentialScore:0}),
  opportunityScoreV2:() => ({action:"PUBLISH"}),
  predictOfferOutcome:() => ({}),
  verificationPlan:() => ({}),
  freshnessSla:() => ({state:"FRESH"}),
  evaluateStockPricePersistence:() => ({}),
  revenueAttributionProfile:() => ({}),
  profitLearningDecision:() => ({}),
  optimizePublishingTime:() => ({}),
  knowledgeProposal:() => ({state:"PROPOSAL",proposalId:"synthetic",commitAllowed:false}),
  releaseManifest:() => ({}),
  semanticDecisionCachePolicy:() => ({}),
  egressGuard:() => ({passed:true}),
  systemMode:() => ({publishingAllowed:true}),
  adaptiveControl33_10:() => ({action:"GO"}),
  agentOsRoutingDecision:() => ({}),
  evaluateRepublish:() => ({allowed:true})
};
const mock = (name) => {
  if (name === "prePublishValidate") return (...args) => {
    const outcome = validatorModule.namespace.prePublishValidate(...args);
    validationCalls.push(outcome);
    return outcome;
  };
  if (name === "publicationRoute" || name === "rewardPrePublishValidate") {
    return validatorModule.namespace[name];
  }
  if (Object.hasOwn(stubs,name)) return stubs[name];
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
// Load the real validator and routing functions; mock only non-gate dependencies.
validatorModule = new vm.SourceTextModule(
  fs.readFileSync(new URL("../lib/pre-publish-validator.js", import.meta.url), "utf8"),
  {context,identifier:"lib/pre-publish-validator.js"}
);
await validatorModule.link(() => { throw new Error("Unexpected validator import"); });
await validatorModule.evaluate();
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
// Exercise the actual commercial handler path with the actual strict validator.
// Simulated upstream services are permissive so only the strict gate can reject.
const commercialBase = {
  asin:"B012345678",
  amazonUrl:"https://www.amazon.it/dp/B012345678",
  source:"external_signal",
  price:"24.99",
  dealScore:99,
  reliabilityScore:96,
  stock:true,
  lastVerifiedAt:new Date().toISOString(),
  sourceVerified:true,
  priceVerifiedByAmazon:false
};
for (const [fixture,expectedBlock] of [
  [commercialBase,"MISSING_PRICE_VERIFICATION"],
  [{...commercialBase,priceVerified:false},"PRICE_NOT_VERIFIED"],
  [{...commercialBase,priceVerified:true,lastVerifiedAt:new Date(Date.now()-11*60*1000).toISOString()},"STALE_VERIFICATION"],
  [{...commercialBase,priceVerified:true,lastVerifiedAt:null},"MISSING_VERIFICATION_TIMESTAMP"],
  [{...commercialBase,priceVerified:true,coupon:"10%"},"MISSING_COUPON_VERIFICATION"]
]) {
  const observed = await invoke(fixture);
  assert.equal(observed.status,200);
  assert.equal(observed.data.published,false);
  assert.equal(observed.data.reason,"revalidation_failed");
  assert.equal(observed.data.revalidation.mode,"strict");
  assert.ok(observed.data.revalidation.blockingCodes.includes(expectedBlock),expectedBlock);
  assert.equal(forbidden.length,0,"No external network or Telegram request is permitted on failure");
}
assert.equal(validationCalls.length,5,"Commercial cases must actually reach the strict validator");
assert.deepEqual(forbidden,[]);
console.log("isolated auto-publish endpoint guard and commercial rejection tests passed");
