import assert from "node:assert/strict";
import { joinAffareRadarRealOutcomes } from "./lib/affareradar-real-outcome-joiner.js";

const H = "a".repeat(64);
const shadow = [{
  decision_id:"d1",
  baseline_decision:"PUBLISH",
  backport_decision:"BLOCK",
  evidence_contract:"agentos.verified_evidence.v1",
  evidence_hash_version:"2",
  evidence_hash:H
}];

const noQuality = joinAffareRadarRealOutcomes({
  shadowRecords:shadow,
  recentDecisions:[{decisionId:"d1", action:"PUBLISHED"}],
  recentOutcomes:[{decisionId:"d1", outcomeId:"o1", conversions:1, revenueEUR:5}]
});
assert.equal(noQuality.joined_count, 1);
assert.equal(noQuality.known_quality_outcome_count, 0);
assert.equal(noQuality.joined[0].outcome, "UNKNOWN");

const known = joinAffareRadarRealOutcomes({
  shadowRecords:shadow,
  recentDecisions:[{decisionId:"d1", action:"PUBLISHED"}],
  recentOutcomes:[{decisionId:"d1", outcomeId:"o1", qualityOutcome:"BAD", conversions:0}]
});
assert.equal(known.known_quality_outcome_count, 1);
assert.equal(known.joined[0].outcome, "BAD");

const missing = joinAffareRadarRealOutcomes({
  shadowRecords:shadow,
  recentDecisions:[],
  recentOutcomes:[]
});
assert.equal(missing.joined_count, 0);
assert.equal(missing.unresolved_count, 1);

console.log("affareradar real outcome joiner: PASS");
