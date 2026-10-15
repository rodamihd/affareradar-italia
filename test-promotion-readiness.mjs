import assert from "node:assert/strict";
import {
  assessPromotionReadiness,
  DEFAULT_PROMOTION_THRESHOLDS
} from "./lib/promotion-readiness-gate.js";

const insufficient = assessPromotionReadiness({
  summary:{
    known_outcome_count:10,
    known_would_block_count:4,
    false_block_count:0,
    false_block_rate:0,
    risk_relaxation_count:0
  },
  ciGreen:true,
  evidenceVerified:true
});
assert.equal(insufficient.status, "REVIEW");
assert.equal(insufficient.automatic_promotion, false);
assert.equal(insufficient.blockers.includes("INSUFFICIENT_KNOWN_OUTCOMES"), true);
assert.equal(insufficient.blockers.includes("INSUFFICIENT_WOULD_BLOCK_EVIDENCE"), true);

const falseBlockTooHigh = assessPromotionReadiness({
  summary:{
    known_outcome_count:100,
    known_would_block_count:40,
    false_block_count:4,
    false_block_rate:0.10,
    risk_relaxation_count:0
  },
  ciGreen:true,
  evidenceVerified:true
});
assert.equal(falseBlockTooHigh.status, "NOT_READY");
assert.equal(falseBlockTooHigh.hard_blockers.includes("FALSE_BLOCK_RATE_TOO_HIGH"), true);

const relaxation = assessPromotionReadiness({
  summary:{
    known_outcome_count:100,
    known_would_block_count:40,
    false_block_count:0,
    false_block_rate:0,
    risk_relaxation_count:1
  },
  ciGreen:true,
  evidenceVerified:true
});
assert.equal(relaxation.status, "NOT_READY");
assert.equal(relaxation.hard_blockers.includes("RISK_RELAXATION_PRESENT"), true);

const ciFailure = assessPromotionReadiness({
  summary:{
    known_outcome_count:100,
    known_would_block_count:40,
    false_block_count:0,
    false_block_rate:0,
    risk_relaxation_count:0
  },
  ciGreen:false,
  evidenceVerified:true
});
assert.equal(ciFailure.status, "NOT_READY");
assert.equal(ciFailure.hard_blockers.includes("CI_NOT_GREEN"), true);

const ready = assessPromotionReadiness({
  summary:{
    known_outcome_count:100,
    known_would_block_count:40,
    false_block_count:1,
    false_block_rate:0.025,
    risk_relaxation_count:0
  },
  ciGreen:true,
  evidenceVerified:true
});
assert.equal(ready.status, "READY_FOR_HUMAN_REVIEW");
assert.equal(ready.automatic_promotion, false);
assert.equal(ready.human_review_required, true);
assert.deepEqual(ready.blockers, []);

assert.equal(DEFAULT_PROMOTION_THRESHOLDS.min_known_outcomes, 50);
assert.equal(DEFAULT_PROMOTION_THRESHOLDS.min_known_would_block, 20);
assert.equal(DEFAULT_PROMOTION_THRESHOLDS.max_false_block_rate, 0.05);

console.log("promotion readiness gate: PASS");
