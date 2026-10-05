import assert from "node:assert/strict";
import {
  checkCrossVerticalConsistency,
  commonEventType
} from "./lib/cross-vertical-consistency-check.js";

for (const [vertical, baseline, blocked] of [
  ["affareradar","PUBLISH","BLOCK"],
  ["quotai","PLAY","REJECT"],
  ["sceltasemplice","PROPOSE","BLOCK"]
]){
  assert.equal(commonEventType({
    vertical,
    baseline_decision:baseline,
    shadow_decision:blocked,
    outcome:"BAD"
  }), "SAFETY_CATCH");
  assert.equal(commonEventType({
    vertical,
    baseline_decision:baseline,
    shadow_decision:blocked,
    outcome:"GOOD"
  }), "FALSE_BLOCK");
}

const good = checkCrossVerticalConsistency({
  records:[
    {
      vertical:"affareradar",
      mode:"shadow",
      baseline_decision:"PUBLISH",
      shadow_decision:"REVIEW",
      evidence_contract:"agentos.verified_evidence.v1",
      evidence_hash_version:"2"
    },
    {
      vertical:"quotai",
      mode:"shadow",
      baseline_decision:"PLAY",
      shadow_decision:"WATCH",
      evidence_contract:"agentos.verified_evidence.v1",
      evidence_hash_version:"2"
    },
    {
      vertical:"sceltasemplice",
      mode:"contract_only",
      baseline_decision:"PROPOSE",
      shadow_decision:"REVIEW",
      promotion_eligible:false
    }
  ],
  readiness:{
    affareradar:{status:"REVIEW",automatic_promotion:false,human_review_required:true},
    quotai:{status:"REVIEW",automatic_promotion:false,human_review_required:true},
    sceltasemplice:{status:"REVIEW",automatic_promotion:false,human_review_required:true}
  },
  statistical:{
    affareradar:{status:"STATISTICALLY_INCONCLUSIVE"},
    quotai:{status:"STATISTICALLY_INCONCLUSIVE"}
  }
});
assert.equal(good.status, "CONSISTENT");

const relaxation = checkCrossVerticalConsistency({
  records:[{
    vertical:"quotai",
    mode:"shadow",
    baseline_decision:"REJECT",
    shadow_decision:"PLAY"
  }]
});
assert.equal(relaxation.consistent, false);
assert.equal(relaxation.issues.some(x => x.code === "RISK_RELAXATION_PRESENT"), true);

const contractLeak = checkCrossVerticalConsistency({
  records:[{
    vertical:"sceltasemplice",
    mode:"contract_only",
    baseline_decision:"PROPOSE",
    shadow_decision:"REVIEW",
    promotion_eligible:true
  }]
});
assert.equal(contractLeak.issues.some(x => x.code === "CONTRACT_ONLY_RECORD_PROMOTION_ELIGIBLE"), true);

const contradiction = checkCrossVerticalConsistency({
  readiness:{
    affareradar:{
      status:"READY_FOR_HUMAN_REVIEW",
      automatic_promotion:false,
      human_review_required:true
    }
  },
  statistical:{
    affareradar:{status:"STATISTICALLY_INCONCLUSIVE"}
  }
});
assert.equal(contradiction.consistent, false);
assert.equal(
  contradiction.issues.some(x => x.code === "READINESS_STATISTICAL_CONTRADICTION"),
  true
);

console.log("cross vertical consistency: PASS");
