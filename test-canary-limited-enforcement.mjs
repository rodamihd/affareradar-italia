import assert from "node:assert/strict";
import {
  assessCanaryActivation,
  applyLimitedEnforcement,
  assessCanaryRollback
} from "./lib/canary-limited-enforcement.js";

const compositeReady = {
  status:"READY_FOR_HUMAN_REVIEW",
  promotion_candidate:true
};
const designEligible = {
  status:"DESIGN_ELIGIBLE",
  requested_stage:"GATED_ENFORCEMENT"
};
const approval = {
  approved:true,
  approved_by:"reviewer-1",
  change_ticket:"CHG-014"
};
const canary = {
  max_traffic_pct:5,
  scope_allowlist:["low-risk"],
  rollback_defined:true
};

const syntheticBlocked = assessCanaryActivation({
  vertical:"affareradar",
  currentStage:"ADVISORY",
  compositeReview:compositeReady,
  promotionDesign:designEligible,
  evidence:{
    source:"synthetic",
    known_outcomes:500,
    statistical_status:"FALSE_BLOCK_BOUND_SUPPORTED",
    consistency_status:"CONSISTENT"
  },
  ciGreen:true,
  evidenceVerified:true,
  riskRelaxations:0,
  manualApproval:approval,
  canary
});
assert.equal(syntheticBlocked.status, "CANARY_BLOCKED");
assert.equal(
  syntheticBlocked.blockers.some(x => x.code === "REAL_EVIDENCE_REQUIRED"),
  true
);

const insufficientReal = assessCanaryActivation({
  vertical:"affareradar",
  currentStage:"ADVISORY",
  compositeReview:compositeReady,
  promotionDesign:designEligible,
  evidence:{
    source:"real",
    known_outcomes:0,
    statistical_status:"INSUFFICIENT_SAMPLE",
    consistency_status:"CONSISTENT"
  },
  ciGreen:true,
  evidenceVerified:true,
  riskRelaxations:0,
  manualApproval:approval,
  canary
});
assert.equal(insufficientReal.status, "CANARY_BLOCKED");

const eligible = assessCanaryActivation({
  vertical:"affareradar",
  currentStage:"ADVISORY",
  compositeReview:compositeReady,
  promotionDesign:designEligible,
  evidence:{
    source:"real",
    known_outcomes:150,
    statistical_status:"FALSE_BLOCK_BOUND_SUPPORTED",
    consistency_status:"CONSISTENT",
    incident_count:0,
    regression_count:0
  },
  ciGreen:true,
  evidenceVerified:true,
  riskRelaxations:0,
  manualApproval:approval,
  canary
});
assert.equal(eligible.status, "CANARY_ELIGIBLE");
assert.equal(eligible.activation_permitted, true);
assert.ok(eligible.limits.max_traffic_pct <= 5);

const outsideScope = applyLimitedEnforcement({
  activation:eligible,
  decision:{
    decision_id:"d-1",
    baseline_decision:"PUBLISH",
    shadow_decision:"BLOCK"
  },
  riskClass:"high-risk"
});
assert.equal(outsideScope.applied, false);
assert.equal(outsideScope.reason, "OUTSIDE_SCOPE_ALLOWLIST");

let selected = null;
for (let i = 0; i < 10000; i += 1){
  const candidate = applyLimitedEnforcement({
    activation:eligible,
    decision:{
      decision_id:"candidate-" + i,
      baseline_decision:"PUBLISH",
      shadow_decision:"BLOCK"
    },
    riskClass:"low-risk"
  });
  if (candidate.applied){
    selected = candidate;
    break;
  }
}
assert.ok(selected);
assert.equal(selected.decision, "REVIEW");
assert.equal(selected.effect, "ROUTE_TO_REVIEW");

const rollback = assessCanaryRollback({
  activation:eligible,
  observed:{
    risk_relaxations:0,
    incident_count:1,
    regression_count:0,
    statistical_status:"FALSE_BLOCK_BOUND_SUPPORTED",
    consistency_status:"CONSISTENT",
    ci_green:true,
    evidence_verified:true
  }
});
assert.equal(rollback.rollback_required, true);
assert.equal(rollback.rollback_target, "SHADOW");
assert.equal(rollback.automatic_rollback, false);

console.log("limited enforcement canary: PASS");
