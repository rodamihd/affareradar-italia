import assert from "node:assert/strict";
import { accumulateRealAdvisoryOutcomes } from "./lib/real-advisory-outcome-accumulator.js";

const result = accumulateRealAdvisoryOutcomes({
  advisoryRows:[
    {decision_id:"r1",source:"real"},
    {decision_id:"r2",source:"real"},
    {decision_id:"s1",source:"synthetic"},
    {decision_id:"p1",source:"replay"}
  ],
  outcomeRows:[
    {decision_id:"r1",source:"real",quality_outcome:"GOOD"},
    {decision_id:"r2",source:"synthetic",quality_outcome:"BAD"},
    {decision_id:"s1",source:"real",quality_outcome:"GOOD"}
  ]
});

assert.equal(result.total_real_advisory, 2);
assert.equal(result.known_real_outcomes, 1);
assert.equal(result.pending_real_outcomes, 1);
assert.equal(result.rejected_non_real, 2);
assert.equal(result.promotion_eligible_real_evidence, 1);
assert.equal(result.automatic_promotion, false);

console.log("real advisory outcome accumulator: PASS");
