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

const scalarA = evaluateVerifiedBackportShadow({
  ...baseInput,
  eventId:"hash-scalars-a",
  evidence:{
    nullValue:null,
    enabled:true,
    disabled:false,
    zero:0,
    negative:-7.5,
    text:"caffè ☕",
    unicodeKey:{"è":"accented","東京":"tokyo"}
  }
});
const scalarB = evaluateVerifiedBackportShadow({
  ...baseInput,
  eventId:"hash-scalars-b",
  evidence:{
    unicodeKey:{"東京":"tokyo","è":"accented"},
    text:"caffè ☕",
    negative:-7.5,
    zero:0,
    disabled:false,
    enabled:true,
    nullValue:null
  }
});
assert.equal(
  scalarA.evidence_hash,
  scalarB.evidence_hash,
  "Valid JSON scalars and Unicode keys must canonicalize deterministically"
);

assert.throws(
  () => evaluateVerifiedBackportShadow({
    ...baseInput,
    evidence:{bad:undefined}
  }),
  /unsupported undefined/,
  "Undefined evidence must be rejected rather than silently omitted"
);

assert.throws(
  () => evaluateVerifiedBackportShadow({
    ...baseInput,
    evidence:{bad:1n}
  }),
  /unsupported bigint/,
  "BigInt evidence must be rejected explicitly"
);

assert.throws(
  () => evaluateVerifiedBackportShadow({
    ...baseInput,
    evidence:{bad:Number.NaN}
  }),
  /non-finite number/,
  "NaN evidence must be rejected explicitly"
);

assert.throws(
  () => evaluateVerifiedBackportShadow({
    ...baseInput,
    evidence:{bad:Number.POSITIVE_INFINITY}
  }),
  /non-finite number/,
  "Infinite evidence must be rejected explicitly"
);

const cyclic = {};
cyclic.self = cyclic;
assert.throws(
  () => evaluateVerifiedBackportShadow({
    ...baseInput,
    evidence:{cyclic}
  }),
  /circular reference/,
  "Circular evidence must be rejected explicitly"
);

assert.throws(
  () => evaluateVerifiedBackportShadow({
    ...baseInput,
    evidence:{date:new Date("2026-10-04T00:00:00Z")}
  }),
  /non-plain object/,
  "Non-plain objects must be normalized by callers before entering evidence"
);

console.log("agentos verified shadow: PASS");
