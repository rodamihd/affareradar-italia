import assert from "node:assert/strict";
import {
  buildAdvisorySurface,
  summarizeAdvisoryObservations
} from "./lib/advisory-shadow-surface.js";

const advisory = buildAdvisorySurface({
  shadowRecord:{
    vertical:"affareradar",
    decision_id:"d1",
    baseline_decision:"PUBLISH",
    backport_decision:"REVIEW",
    diverged:true,
    reasons:["verification_required"],
    evidence_contract:"agentos.verified_evidence.v1",
    evidence_hash_version:"2",
    evidence_hash:"a".repeat(64)
  },
  statistical:{
    status:"STATISTICALLY_INCONCLUSIVE",
    confidence:0.5,
    quality_outcome:"NEUTRAL"
  },
  compositeReview:{
    status:"REVIEW",
    promotion_candidate:false
  }
});

assert.equal(advisory.mode, "advisory");
assert.equal(advisory.baseline_decision, "PUBLISH");
assert.equal(advisory.advisory_decision, "REVIEW");
assert.equal(advisory.human_action_required, true);
assert.equal(advisory.enforcement, false);
assert.equal(advisory.production_mutation, false);
assert.equal(advisory.publish_effect, false);
assert.equal(advisory.automatic_promotion, false);

const summary = summarizeAdvisoryObservations([
  {
    vertical:"affareradar",
    decision_id:"d1",
    baseline_decision:"PUBLISH",
    backport_decision:"REVIEW"
  },
  {
    vertical:"affareradar",
    decision_id:"d2",
    baseline_decision:"PUBLISH",
    backport_decision:"PUBLISH"
  }
]);

assert.equal(summary.total, 2);
assert.equal(summary.diverged, 1);
assert.equal(summary.enforcement_count, 0);
assert.equal(summary.production_mutation_count, 0);

console.log("advisory shadow surface: PASS");
