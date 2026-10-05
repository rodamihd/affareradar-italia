import assert from "node:assert/strict";
import { buildAffareRadarVerifiedShadowTelemetry } from "./lib/affareradar-verified-shadow-telemetry.js";

const base = {
  decisionId:"decision_123",
  action:"PUBLISHED",
  reason:"published",
  opportunityScore:91,
  predictionScore:85,
  sourceReputation:88
};

const shadow = buildAffareRadarVerifiedShadowTelemetry(
  base,
  "published",
  {dealId:"ASIN123"},
  {
    verification:{state:"VERIFIED"},
    policy:{blocking:[]},
    egress:{passed:true},
    runtimeIntegrity:{status:"VALID"},
    workloadIdentity:{grantPresent:true}
  }
);

assert.equal(shadow.decision_id, "decision_123");
assert.equal(shadow.event_id, "decision_123");
assert.equal(shadow.baseline_decision, "PUBLISH");
assert.equal(shadow.backport_decision, "PUBLISH");
assert.equal(shadow.enforcement, false);
assert.equal(shadow.evidence.dealId, "ASIN123");

const review = buildAffareRadarVerifiedShadowTelemetry(
  {...base, decisionId:"decision_456"},
  "published",
  {dealId:"ASIN456"},
  {
    verification:{state:"VERIFIED"},
    policy:{blocking:[]},
    egress:{passed:true},
    runtimeIntegrity:{status:"VALID"},
    workloadIdentity:{grantPresent:false}
  }
);
assert.equal(review.decision_id, "decision_456");
assert.equal(review.backport_decision, "REVIEW");
assert.equal(review.diverged, true);

assert.equal(buildAffareRadarVerifiedShadowTelemetry(null, "published"), null);

console.log("affareradar verified shadow telemetry: PASS");
