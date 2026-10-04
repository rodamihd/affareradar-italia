import assert from "node:assert/strict";
import { evaluateVerifiedBackportShadow } from "./lib/agentos-33_10-verified-shadow.js";

const good = evaluateVerifiedBackportShadow({
  eventId:"deal-1",
  productionDecision:"published",
  verification:{state:"VERIFIED"},
  policy:{blocking:[]},
  egress:{passed:true},
  runtimeIntegrity:{status:"VALID"},
  workloadIdentity:{grantPresent:true}
});
assert.equal(good.backport_decision, "PUBLISH");
assert.equal(good.enforcement, false);

const missingGrant = evaluateVerifiedBackportShadow({
  eventId:"deal-2",
  productionDecision:"published",
  verification:{state:"VERIFIED"},
  policy:{blocking:[]},
  egress:{passed:true},
  runtimeIntegrity:{status:"VALID"},
  workloadIdentity:{grantPresent:false}
});
assert.equal(missingGrant.backport_decision, "REVIEW");
assert.equal(missingGrant.diverged, true);

const tampered = evaluateVerifiedBackportShadow({
  eventId:"deal-3",
  productionDecision:"published",
  verification:{state:"VERIFIED"},
  policy:{blocking:[]},
  egress:{passed:true},
  runtimeIntegrity:{status:"TAMPERED"},
  workloadIdentity:{grantPresent:true}
});
assert.equal(tampered.backport_decision, "BLOCK");
assert.equal(tampered.would_block, true);

const prodBlock = evaluateVerifiedBackportShadow({
  eventId:"deal-4",
  productionDecision:"blocked",
  verification:{state:"VERIFIED"},
  policy:{blocking:[]},
  egress:{passed:true},
  runtimeIntegrity:{status:"VALID"},
  workloadIdentity:{grantPresent:true}
});
assert.equal(prodBlock.backport_decision, "BLOCK");
assert.equal(prodBlock.risk_relaxation, false);

console.log("agentos verified shadow: PASS");
