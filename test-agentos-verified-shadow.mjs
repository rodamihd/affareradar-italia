import assert from "node:assert/strict";
import { evaluateVerifiedBackportShadow } from "./lib/agentos-33_10-verified-shadow.js";

const baseInput = {
  productionDecision:"published",
  verification:{state:"VERIFIED"},
  policy:{blocking:[]},
  egress:{passed:true},
  runtimeIntegrity:{status:"VALID"},
  workloadIdentity:{grantPresent:true}
};

const good = evaluateVerifiedBackportShadow({
  ...baseInput,
  eventId:"deal-1"
});
assert.equal(good.backport_decision, "PUBLISH");
assert.equal(good.enforcement, false);
assert.equal(good.evidence_hash_version, "2");

const missingGrant = evaluateVerifiedBackportShadow({
  ...baseInput,
  eventId:"deal-2",
  workloadIdentity:{grantPresent:false}
});
assert.equal(missingGrant.backport_decision, "REVIEW");
assert.equal(missingGrant.diverged, true);

const tampered = evaluateVerifiedBackportShadow({
  ...baseInput,
  eventId:"deal-3",
  runtimeIntegrity:{status:"TAMPERED"}
});
assert.equal(tampered.backport_decision, "BLOCK");
assert.equal(tampered.would_block, true);

const prodBlock = evaluateVerifiedBackportShadow({
  ...baseInput,
  eventId:"deal-4",
  productionDecision:"blocked"
});
assert.equal(prodBlock.backport_decision, "BLOCK");
assert.equal(prodBlock.risk_relaxation, false);

const nestedA = evaluateVerifiedBackportShadow({
  ...baseInput,
  eventId:"hash-a",
  evidence:{
    deal:{price:99.99, coupon:{code:"SAVE10", percent:10}},
    tags:["amazon","coupon"],
    flags:{prime:true}
  }
});
const nestedB = evaluateVerifiedBackportShadow({
  ...baseInput,
  eventId:"hash-b",
  evidence:{
    flags:{prime:true},
    tags:["amazon","coupon"],
    deal:{coupon:{percent:10, code:"SAVE10"}, price:99.99}
  }
});
assert.equal(
  nestedA.evidence_hash,
  nestedB.evidence_hash,
  "Equivalent nested evidence with different key order must hash identically"
);

const nestedChanged = evaluateVerifiedBackportShadow({
  ...baseInput,
  eventId:"hash-c",
  evidence:{
    deal:{price:99.99, coupon:{code:"SAVE10", percent:15}},
    tags:["amazon","coupon"],
    flags:{prime:true}
  }
});
assert.notEqual(
  nestedA.evidence_hash,
  nestedChanged.evidence_hash,
  "Changing a deeply nested evidence value must change the hash"
);

const arrayChanged = evaluateVerifiedBackportShadow({
  ...baseInput,
  eventId:"hash-d",
  evidence:{
    deal:{price:99.99, coupon:{code:"SAVE10", percent:10}},
    tags:["coupon","amazon"],
    flags:{prime:true}
  }
});
assert.notEqual(
  nestedA.evidence_hash,
  arrayChanged.evidence_hash,
  "Array order is semantic and must affect the hash"
);

console.log("agentos verified shadow: PASS");
