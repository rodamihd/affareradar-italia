export const CROSS_VERTICAL_GOVERNANCE_CONTRACT = "agentos.cross_vertical_governance.v1";

export const CROSS_VERTICAL_PROFILES = Object.freeze({
  affareradar:{
    mode:"shadow",
    promotion_eligible:true,
    decision_order:["PUBLISH","REVIEW","BLOCK"]
  },
  quotai:{
    mode:"shadow",
    promotion_eligible:true,
    decision_order:["PLAY","WATCH","REJECT"]
  },
  sceltasemplice:{
    mode:"contract_only",
    promotion_eligible:false,
    decision_order:["PROPOSE","REVIEW","BLOCK"]
  }
});

export const SHARED_GOVERNANCE = Object.freeze({
  evidence_contract:"agentos.verified_evidence.v1",
  evidence_hash_version:"2",
  outcome_contract:"agentos.shadow_outcome.v1",
  promotion_contract:"agentos.promotion_readiness.v1",
  automatic_promotion:false,
  human_review_required:true,
  thresholds:{
    min_known_outcomes:50,
    min_known_would_block:20,
    max_false_block_rate:0.05,
    max_risk_relaxations:0,
    require_ci_green:true,
    require_verified_evidence:true
  }
});

const BAD_STATUSES = new Set([
  "INSUFFICIENT_SAMPLE",
  "STATISTICALLY_INCONCLUSIVE",
  "FALSE_BLOCK_RATE_TOO_HIGH"
]);

function rank(profile, decision){
  const value = String(decision || "").toUpperCase();
  return profile.decision_order.indexOf(value);
}

function addIssue(issues, vertical, code, detail = null){
  issues.push({vertical, code, detail});
}

export function commonEventType({
  vertical,
  baseline_decision,
  shadow_decision,
  outcome = "UNKNOWN"
} = {}){
  const profile = CROSS_VERTICAL_PROFILES[vertical];
  if (!profile) return null;
  const b = rank(profile, baseline_decision);
  const s = rank(profile, shadow_decision);
  if (b < 0 || s < 0) return null;
  const o = String(outcome || "UNKNOWN").toUpperCase();
  const relaxed = s < b;
  const wouldBlock = s === 2 && b !== 2;

  if (relaxed) return "RISK_RELAXATION";
  if (wouldBlock && o === "BAD") return "SAFETY_CATCH";
  if (wouldBlock && o === "GOOD") return "FALSE_BLOCK";
  return null;
}

export function checkCrossVerticalConsistency({
  records = [],
  readiness = {},
  statistical = {},
  profileOverrides = {}
} = {}){
  const issues = [];
  const profiles = {
    ...CROSS_VERTICAL_PROFILES,
    ...profileOverrides
  };

  for (const [vertical, profile] of Object.entries(profiles)){
    if (!Array.isArray(profile.decision_order) || profile.decision_order.length !== 3){
      addIssue(issues, vertical, "DECISION_ORDER_INVALID");
      continue;
    }
    if (new Set(profile.decision_order).size !== 3){
      addIssue(issues, vertical, "DECISION_ORDER_NOT_UNIQUE");
    }
    if (profile.mode === "contract_only" && profile.promotion_eligible !== false){
      addIssue(issues, vertical, "CONTRACT_ONLY_PROMOTION_ELIGIBLE");
    }
  }

  for (const record of records){
    const vertical = String(record.vertical || "").toLowerCase();
    const profile = profiles[vertical];
    if (!profile){
      addIssue(issues, vertical || "unknown", "UNKNOWN_VERTICAL");
      continue;
    }

    if (String(record.mode || profile.mode).toLowerCase() !== profile.mode){
      addIssue(issues, vertical, "MODE_MISMATCH");
    }

    if (record.evidence_contract && record.evidence_contract !== SHARED_GOVERNANCE.evidence_contract){
      addIssue(issues, vertical, "EVIDENCE_CONTRACT_MISMATCH");
    }
    if (record.evidence_hash_version && String(record.evidence_hash_version) !== SHARED_GOVERNANCE.evidence_hash_version){
      addIssue(issues, vertical, "EVIDENCE_HASH_VERSION_MISMATCH");
    }

    const b = rank(profile, record.baseline_decision);
    const s = rank(profile, record.shadow_decision ?? record.backport_decision);
    if (b < 0 || s < 0){
      addIssue(issues, vertical, "DECISION_VALUE_INVALID");
    } else if (s < b){
      addIssue(issues, vertical, "RISK_RELAXATION_PRESENT");
    }

    if (profile.mode === "contract_only" && record.promotion_eligible === true){
      addIssue(issues, vertical, "CONTRACT_ONLY_RECORD_PROMOTION_ELIGIBLE");
    }
  }

  for (const [vertical, result] of Object.entries(readiness)){
    if (!result) continue;
    if (result.automatic_promotion !== false){
      addIssue(issues, vertical, "AUTOMATIC_PROMOTION_NOT_DISABLED");
    }
    if (result.human_review_required !== true){
      addIssue(issues, vertical, "HUMAN_REVIEW_NOT_REQUIRED");
    }

    const profile = profiles[vertical];
    if (profile?.mode === "contract_only" && result.status === "READY_FOR_HUMAN_REVIEW"){
      addIssue(issues, vertical, "CONTRACT_ONLY_READY_MUST_REMAIN_EVIDENCE_ONLY");
    }

    const stat = statistical[vertical];
    if (
      result.status === "READY_FOR_HUMAN_REVIEW" &&
      stat &&
      BAD_STATUSES.has(String(stat.status || "").toUpperCase())
    ){
      addIssue(issues, vertical, "READINESS_STATISTICAL_CONTRADICTION", {
        readiness_status:result.status,
        statistical_status:stat.status
      });
    }
  }

  const eventMatrix = {};
  for (const vertical of Object.keys(profiles)){
    const p = profiles[vertical];
    eventMatrix[vertical] = {
      safety_catch:commonEventType({
        vertical,
        baseline_decision:p.decision_order[0],
        shadow_decision:p.decision_order[2],
        outcome:"BAD"
      }),
      false_block:commonEventType({
        vertical,
        baseline_decision:p.decision_order[0],
        shadow_decision:p.decision_order[2],
        outcome:"GOOD"
      }),
      risk_relaxation:commonEventType({
        vertical,
        baseline_decision:p.decision_order[2],
        shadow_decision:p.decision_order[0],
        outcome:"UNKNOWN"
      })
    };
  }

  const expected = JSON.stringify({
    safety_catch:"SAFETY_CATCH",
    false_block:"FALSE_BLOCK",
    risk_relaxation:"RISK_RELAXATION"
  });

  for (const [vertical, events] of Object.entries(eventMatrix)){
    if (JSON.stringify(events) !== expected){
      addIssue(issues, vertical, "EVENT_SEMANTICS_MISMATCH", events);
    }
  }

  return {
    contract:CROSS_VERTICAL_GOVERNANCE_CONTRACT,
    status:issues.length ? "INCONSISTENT" : "CONSISTENT",
    consistent:issues.length === 0,
    automatic_promotion:false,
    human_review_required:true,
    issues,
    shared_governance:SHARED_GOVERNANCE,
    profiles,
    event_matrix:eventMatrix
  };
}
