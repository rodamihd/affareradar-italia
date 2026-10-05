import assert from "node:assert/strict";
import {
  assessPromotionReadinessReview,
  assessCrossVerticalPromotionReview
} from "./lib/promotion-readiness-review.js";

const baseReady = {
  status:"READY_FOR_HUMAN_REVIEW",
  automatic_promotion:false,
  human_review_required:true
};
const statSupported = {
  status:"FALSE_BLOCK_BOUND_SUPPORTED"
};
const consistent = {
  status:"CONSISTENT",
  consistent:true,
  issues:[]
};

const ready = assessPromotionReadinessReview({
  vertical:"affareradar",
  readiness:baseReady,
  statistical:statSupported,
  consistency:consistent,
  ciGreen:true,
  evidenceVerified:true,
  riskRelaxations:0
});
assert.equal(ready.status, "READY_FOR_HUMAN_REVIEW");
assert.equal(ready.promotion_candidate, true);
assert.equal(ready.automatic_promotion, false);

const oldThresholdOnly = assessPromotionReadinessReview({
  vertical:"affareradar",
  readiness:baseReady,
  statistical:{status:"STATISTICALLY_INCONCLUSIVE"},
  consistency:consistent,
  ciGreen:true,
  evidenceVerified:true,
  riskRelaxations:0
});
assert.equal(oldThresholdOnly.status, "REVIEW");
assert.equal(oldThresholdOnly.promotion_candidate, false);
assert.equal(
  oldThresholdOnly.blockers.some(x => x.code === "STATISTICAL_VALIDATION_NOT_SUPPORTED"),
  true
);

const riskRelaxation = assessPromotionReadinessReview({
  vertical:"quotai",
  readiness:baseReady,
  statistical:statSupported,
  consistency:consistent,
  ciGreen:true,
  evidenceVerified:true,
  riskRelaxations:1
});
assert.equal(riskRelaxation.status, "NOT_READY");
assert.equal(
  riskRelaxation.hard_blockers.some(x => x.code === "RISK_RELAXATION_PRESENT"),
  true
);

const contractOnly = assessPromotionReadinessReview({
  vertical:"sceltasemplice",
  mode:"contract_only",
  promotionEligible:false,
  readiness:baseReady,
  statistical:statSupported,
  consistency:consistent,
  ciGreen:true,
  evidenceVerified:true
});
assert.equal(contractOnly.status, "CONTRACT_ONLY_EVIDENCE");
assert.equal(contractOnly.promotion_candidate, false);

const aggregate = assessCrossVerticalPromotionReview({
  verticals:{
    affareradar:{
      readiness:baseReady,
      statistical:statSupported,
      consistency:consistent,
      ciGreen:true,
      evidenceVerified:true,
      riskRelaxations:0
    },
    quotai:{
      readiness:baseReady,
      statistical:{status:"STATISTICALLY_INCONCLUSIVE"},
      consistency:consistent,
      ciGreen:true,
      evidenceVerified:true,
      riskRelaxations:0
    },
    sceltasemplice:{
      mode:"contract_only",
      promotionEligible:false,
      readiness:baseReady,
      statistical:statSupported,
      consistency:consistent,
      ciGreen:true,
      evidenceVerified:true
    }
  }
});
assert.equal(aggregate.status, "REVIEW");
assert.equal(aggregate.promotion_candidate, false);
assert.equal(aggregate.verticals.sceltasemplice.status, "CONTRACT_ONLY_EVIDENCE");

console.log("promotion readiness review: PASS");
