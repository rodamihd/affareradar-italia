import assert from "node:assert/strict";
import {
  validateAffareRadarOutcome,
  summarizeShadowStatisticalEvidence,
  wilsonInterval
} from "./lib/statistical-outcome-validation.js";

const low = validateAffareRadarOutcome(
  {predictionScore:90, opportunityScore:90, revenueRPM:3},
  {impressions:20, clicks:5, conversions:1, revenueEUR:5}
);
assert.equal(low.quality_outcome, "UNKNOWN");
assert.equal(low.status, "INSUFFICIENT_EVIDENCE");

const explicitUntrusted = validateAffareRadarOutcome(
  {},
  {qualityOutcome:"GOOD", impressions:0}
);
assert.notEqual(explicitUntrusted.status, "VALIDATED");

const groundTruth = validateAffareRadarOutcome(
  {},
  {qualityOutcome:"BAD", qualityOutcomeSource:"human_verified"}
);
assert.equal(groundTruth.quality_outcome, "BAD");
assert.equal(groundTruth.status, "VALIDATED");
assert.equal(groundTruth.confidence, 1);

const invalid = validateAffareRadarOutcome(
  {},
  {impressions:10, falseDeal:true}
);
assert.equal(invalid.quality_outcome, "BAD");
assert.equal(invalid.basis, "critical_validity_failure");

const rows = [];
for (let i = 0; i < 20; i++){
  rows.push({
    baseline_decision:"PUBLISH",
    shadow_decision:"BLOCK",
    outcome:i === 0 ? "GOOD" : "BAD"
  });
}
for (let i = 0; i < 30; i++){
  rows.push({
    baseline_decision:"PUBLISH",
    shadow_decision:"PUBLISH",
    outcome:"GOOD"
  });
}
const summary = summarizeShadowStatisticalEvidence(rows);
assert.equal(summary.known_outcomes, 50);
assert.equal(summary.known_would_block, 20);
assert.equal(summary.false_blocks, 1);
assert.equal(summary.observed_false_block_rate, 0.05);
assert.equal(summary.status, "STATISTICALLY_INCONCLUSIVE");
assert.ok(summary.false_block_rate_ci95.upper > 0.05);

const zeroOf20 = wilsonInterval(0, 20);
assert.ok(zeroOf20.upper > 0.05);

console.log("statistical outcome validation: PASS");
