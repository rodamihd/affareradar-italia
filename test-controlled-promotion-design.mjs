import assert from "node:assert/strict";
import {
  buildControlledPromotionDesign,
  evaluateRollbackDesign
} from "./lib/controlled-promotion-design.js";

const reviewReady = {
  status:"READY_FOR_HUMAN_REVIEW",
  promotion_candidate:true,
  automatic_promotion:false,
  human_review_required:true
};
const approval = {
  approved:true,
  approved_by:"reviewer-1",
  change_ticket:"CHG-001"
};

const advisory = buildControlledPromotionDesign({
  vertical:"affareradar",
  currentStage:"SHADOW",
  requestedStage:"ADVISORY",
  compositeReview:reviewReady,
  manualApproval:approval
});
assert.equal(advisory.status, "DESIGN_ELIGIBLE");
assert.equal(advisory.execution_permitted, false);
assert.deepEqual(advisory.effects.active, []);

const direct = buildControlledPromotionDesign({
  vertical:"affareradar",
  currentStage:"SHADOW",
  requestedStage:"GATED_ENFORCEMENT",
  compositeReview:reviewReady,
  manualApproval:approval,
  advisoryEvidence:{
    known_outcomes:200,
    statistical_status:"FALSE_BLOCK_BOUND_SUPPORTED",
    consistency_status:"CONSISTENT"
  },
  canary:{
    max_traffic_pct:5,
    scope_allowlist:["low-risk"],
    rollback_defined:true
  }
});
assert.equal(direct.status, "DESIGN_BLOCKED");
assert.equal(
  direct.blockers.some(x => x.code === "DIRECT_SHADOW_TO_ENFORCEMENT_FORBIDDEN"),
  true
);

const gated = buildControlledPromotionDesign({
  vertical:"quotai",
  currentStage:"ADVISORY",
  requestedStage:"GATED_ENFORCEMENT",
  compositeReview:reviewReady,
  manualApproval:approval,
  advisoryEvidence:{
    known_outcomes:120,
    incident_count:0,
    regression_count:0,
    statistical_status:"FALSE_BLOCK_BOUND_SUPPORTED",
    consistency_status:"CONSISTENT"
  },
  canary:{
    max_traffic_pct:3,
    scope_allowlist:["prematch-low-risk"],
    rollback_defined:true
  }
});
assert.equal(gated.status, "DESIGN_ELIGIBLE");
assert.equal(gated.execution_permitted, false);
assert.equal(gated.canary_design.max_traffic_pct, 3);

const scelta = buildControlledPromotionDesign({
  vertical:"sceltasemplice",
  currentStage:"CONTRACT_ONLY",
  requestedStage:"ADVISORY",
  compositeReview:reviewReady,
  manualApproval:approval
});
assert.equal(scelta.status, "DESIGN_BLOCKED");
assert.equal(scelta.execution_permitted, false);

const rollback = evaluateRollbackDesign({
  vertical:"affareradar",
  currentStage:"GATED_ENFORCEMENT",
  signals:{
    risk_relaxations:0,
    statistical_status:"STATISTICALLY_INCONCLUSIVE",
    consistency_status:"CONSISTENT",
    ci_green:true,
    evidence_verified:true,
    incident_count:0,
    regression_count:0
  }
});
assert.equal(rollback.rollback_required, true);
assert.equal(rollback.rollback_target, "SHADOW");
assert.equal(rollback.execution_permitted, false);
assert.equal(
  rollback.triggers.includes("STATISTICAL_SUPPORT_LOST"),
  true
);

console.log("controlled promotion design: PASS");
