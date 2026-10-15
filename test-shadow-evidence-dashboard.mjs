import assert from "node:assert/strict";
import { ingestEvidenceRecords } from "./lib/shadow-evidence-ingestion.js";
import { buildShadowValidationDashboard } from "./lib/shadow-validation-dashboard.js";

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);

const valid = {
  vertical:"quotai",
  mode:"shadow",
  decision_id:"q1",
  outcome_id:"o1",
  baseline_decision:"PLAY",
  shadow_decision:"REJECT",
  outcome:"BAD",
  evidence_contract:"agentos.verified_evidence.v1",
  evidence_hash_version:"2",
  evidence_hash:H1
};

const ingest = ingestEvidenceRecords([
  valid,
  {...valid},
  {...valid, evidence_hash:H2},
  {...valid, decision_id:"q2", evidence_hash:"bad"}
]);

assert.equal(ingest.accepted_count, 1);
assert.equal(ingest.duplicate_count, 1);
assert.equal(ingest.rejected_count, 2);
assert.equal(ingest.rejected.some(x => x.errors.includes("CONFLICTING_DUPLICATE")), true);
assert.equal(ingest.rejected.some(x => x.errors.includes("EVIDENCE_HASH_INVALID")), true);

const records = [];
for (let i = 0; i < 50; i++){
  records.push({
    vertical:"quotai",
    mode:"shadow",
    decision_id:`q-${i}`,
    outcome_id:`qo-${i}`,
    baseline_decision:"PLAY",
    shadow_decision:i < 20 ? "REJECT" : "PLAY",
    outcome:i < 20 ? (i === 0 ? "GOOD" : "BAD") : "GOOD",
    evidence_contract:"agentos.verified_evidence.v1",
    evidence_hash_version:"2",
    evidence_hash:H1
  });
}
records.push({
  vertical:"sceltasemplice",
  mode:"contract_only",
  decision_id:"s1",
  outcome_id:"so1",
  baseline_decision:"PROPOSE",
  shadow_decision:"BLOCK",
  outcome:"GOOD",
  evidence_contract:"agentos.verified_evidence.v1",
  evidence_hash_version:"2",
  evidence_hash:H2
});

const dashboard = buildShadowValidationDashboard(records, {
  ci:{quotai:true, sceltasemplice:true}
});

assert.equal(dashboard.production_mutation, false);
assert.equal(dashboard.automatic_promotion, false);
assert.equal(dashboard.verticals.quotai.known_outcomes, 50);
assert.equal(dashboard.verticals.quotai.known_would_block, 20);
assert.equal(dashboard.verticals.quotai.false_blocks, 1);
assert.equal(dashboard.verticals.quotai.false_block_rate_pct, 5);
assert.equal(dashboard.verticals.quotai.status, "READY_FOR_HUMAN_REVIEW");
assert.equal(dashboard.verticals.sceltasemplice.promotion_eligible_records, 0);
assert.equal(dashboard.aggregate.known_outcomes, 50);

console.log("shadow evidence ingestion/dashboard: PASS");
