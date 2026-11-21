import assert from "node:assert/strict";
import {
  classifyShadowOutcome,
  summarizeShadowOutcomes
} from "./lib/verified-shadow-outcome-registry.js";

const catchEvent = classifyShadowOutcome({
  decisionId:"d1",
  outcomeId:"o1",
  baselineDecision:"PUBLISH",
  shadowDecision:"BLOCK",
  outcome:"BAD",
  vertical:"affareradar"
});
assert.equal(catchEvent.event_type, "SAFETY_CATCH");
assert.equal(catchEvent.known_outcome, true);
assert.equal(catchEvent.would_block, true);

const falseBlock = classifyShadowOutcome({
  decisionId:"d2",
  outcomeId:"o2",
  baselineDecision:"PUBLISH",
  shadowDecision:"BLOCK",
  outcome:"GOOD",
  vertical:"affareradar"
});
assert.equal(falseBlock.event_type, "FALSE_BLOCK");

const relaxation = classifyShadowOutcome({
  decisionId:"d3",
  outcomeId:"o3",
  baselineDecision:"BLOCK",
  shadowDecision:"PUBLISH",
  outcome:"BAD",
  vertical:"affareradar"
});
assert.equal(relaxation.event_type, "RISK_RELAXATION");
assert.equal(relaxation.risk_relaxation, true);

const unknown = classifyShadowOutcome({
  decisionId:"d4",
  baselineDecision:"PUBLISH",
  shadowDecision:"REVIEW",
  outcome:"UNKNOWN"
});
assert.equal(unknown.event_type, null);
assert.equal(unknown.known_outcome, false);
assert.equal(unknown.diverged, true);

const summary = summarizeShadowOutcomes([
  {
    decisionId:"d1",
    outcomeId:"o1",
    baselineDecision:"PUBLISH",
    shadowDecision:"BLOCK",
    outcome:"BAD"
  },
  {
    decisionId:"d2",
    outcomeId:"o2",
    baselineDecision:"PUBLISH",
    shadowDecision:"BLOCK",
    outcome:"GOOD"
  },
  {
    decisionId:"d3",
    outcomeId:"o3",
    baselineDecision:"BLOCK",
    shadowDecision:"PUBLISH",
    outcome:"BAD"
  },
  {
    decisionId:"d4",
    baselineDecision:"PUBLISH",
    shadowDecision:"REVIEW",
    outcome:"UNKNOWN"
  }
]);

assert.equal(summary.total_count, 4);
assert.equal(summary.known_outcome_count, 3);
assert.equal(summary.unknown_outcome_count, 1);
assert.equal(summary.divergence_count, 4);
assert.equal(summary.safety_catch_count, 1);
assert.equal(summary.false_block_count, 1);
assert.equal(summary.risk_relaxation_count, 1);
assert.equal(summary.known_would_block_count, 2);
assert.equal(summary.false_block_rate, 0.5);
assert.equal(summary.promotion_blockers.risk_relaxation, true);
assert.equal(summary.promotion_blockers.false_block, true);
assert.equal(summary.promotion_blockers.insufficient_known_outcomes, false);

const empty = summarizeShadowOutcomes([]);
assert.equal(empty.known_outcome_count, 0);
assert.equal(empty.false_block_rate, null);
assert.equal(empty.promotion_blockers.insufficient_known_outcomes, true);

console.log("verified shadow outcome registry: PASS");
