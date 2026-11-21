import assert from "node:assert/strict";
import { buildCrossVerticalShadowReport } from "./lib/cross-vertical-shadow-report.js";

const H = "a".repeat(64);
const records = [
  {
    vertical:"quotai",
    mode:"shadow",
    decision_id:"q1",
    outcome_id:"qo1",
    baseline_decision:"PLAY",
    shadow_decision:"REJECT",
    outcome:"BAD",
    evidence_contract:"agentos.verified_evidence.v1",
    evidence_hash_version:"2",
    evidence_hash:H
  },
  {
    vertical:"quotai",
    mode:"shadow",
    decision_id:"q2",
    outcome_id:"qo2",
    baseline_decision:"PLAY",
    shadow_decision:"REJECT",
    outcome:"GOOD",
    evidence_contract:"agentos.verified_evidence.v1",
    evidence_hash_version:"2",
    evidence_hash:H
  },
  {
    vertical:"affareradar",
    mode:"shadow",
    decision_id:"a1",
    outcome_id:"ao1",
    baseline_decision:"PUBLISH",
    shadow_decision:"BLOCK",
    outcome:"BAD",
    evidence_contract:"agentos.verified_evidence.v1",
    evidence_hash_version:"2",
    evidence_hash:H
  },
  {
    vertical:"sceltasemplice",
    mode:"contract_only",
    decision_id:"s1",
    outcome_id:"so1",
    baseline_decision:"PROPOSE",
    shadow_decision:"BLOCK",
    outcome:"GOOD",
    evidence_contract:"agentos.verified_evidence.v1",
    evidence_hash_version:"2",
    evidence_hash:H
  }
];

const report = buildCrossVerticalShadowReport(records, {
  ci:{quotai:true, affareradar:true, sceltasemplice:true}
});

assert.equal(report.vertical_count, 3);
assert.equal(report.contract_only_excluded_from_promotion, true);

assert.equal(report.verticals.quotai.outcomes.known_outcome_count, 2);
assert.equal(report.verticals.quotai.outcomes.safety_catch_count, 1);
assert.equal(report.verticals.quotai.outcomes.false_block_count, 1);
assert.equal(report.verticals.quotai.outcomes.false_block_rate, 0.5);

assert.equal(report.verticals.affareradar.outcomes.safety_catch_count, 1);
assert.equal(report.verticals.sceltasemplice.contract_only_records, 1);
assert.equal(report.verticals.sceltasemplice.promotion_eligible_records, 0);
assert.equal(report.verticals.sceltasemplice.outcomes.known_outcome_count, 0);

assert.equal(report.aggregate.promotion_eligible_records, 3);
assert.equal(report.aggregate.outcomes.known_outcome_count, 3);
assert.equal(report.aggregate.outcomes.safety_catch_count, 2);
assert.equal(report.aggregate.outcomes.false_block_count, 1);

console.log("cross vertical shadow report: PASS");
