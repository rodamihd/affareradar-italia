export const CONTROLLED_PROMOTION_CONTRACT = "agentos.controlled_promotion_design.v1";

export const PROMOTION_STAGES = Object.freeze({
  CONTRACT_ONLY:"CONTRACT_ONLY",
  SHADOW:"SHADOW",
  ADVISORY:"ADVISORY",
  GATED_ENFORCEMENT:"GATED_ENFORCEMENT"
});

export const VERTICAL_PROMOTION_PROFILES = Object.freeze({
  affareradar:{
    start_stage:"SHADOW",
    promotion_eligible:true,
    advisory_effects:[
      "surface_shadow_decision",
      "surface_reasons",
      "surface_evidence_status"
    ],
    future_gated_effects:[
      "route_candidate_to_review",
      "hold_candidate_before_publish"
    ],
    forbidden_effects:[
      "telegram_send",
      "redis_production_mutation",
      "automatic_publish_override",
      "automatic_promotion"
    ]
  },
  quotai:{
    start_stage:"SHADOW",
    promotion_eligible:true,
    advisory_effects:[
      "surface_shadow_decision",
      "surface_edge_evidence",
      "surface_risk_reason"
    ],
    future_gated_effects:[
      "downgrade_candidate_to_watch",
      "require_human_confirmation"
    ],
    forbidden_effects:[
      "wager_placement",
      "stake_change",
      "account_action",
      "automatic_promotion"
    ]
  },
  sceltasemplice:{
    start_stage:"CONTRACT_ONLY",
    promotion_eligible:false,
    advisory_effects:[],
    future_gated_effects:[],
    forbidden_effects:[
      "tariff_switch",
      "supplier_submission",
      "consent_execution",
      "customer_notification",
      "account_mutation",
      "automatic_promotion"
    ]
  }
});

const NEXT_STAGE = Object.freeze({
  SHADOW:"ADVISORY",
  ADVISORY:"GATED_ENFORCEMENT"
});

function issue(code, detail = null, hard = true){
  return {code, detail, hard};
}

function nonEmpty(value){
  return typeof value === "string" && value.trim().length > 0;
}

function percent(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildControlledPromotionDesign({
  vertical,
  currentStage,
  requestedStage,
  compositeReview = {},
  manualApproval = {},
  advisoryEvidence = {},
  canary = {}
} = {}){
  const v = String(vertical || "").toLowerCase();
  const profile = VERTICAL_PROMOTION_PROFILES[v];
  const blockers = [];

  if (!profile){
    return {
      contract:CONTROLLED_PROMOTION_CONTRACT,
      vertical:v || "unknown",
      status:"DESIGN_BLOCKED",
      execution_permitted:false,
      activation_requested:false,
      automatic_promotion:false,
      blockers:[issue("UNKNOWN_VERTICAL")]
    };
  }

  const current = String(currentStage || profile.start_stage).toUpperCase();
  const requested = String(requestedStage || "").toUpperCase();

  if (!profile.promotion_eligible || current === "CONTRACT_ONLY"){
    blockers.push(issue("CONTRACT_ONLY_NOT_PROMOTION_ELIGIBLE", null, false));
  }

  if (!Object.values(PROMOTION_STAGES).includes(current)){
    blockers.push(issue("CURRENT_STAGE_INVALID", {current}));
  }
  if (!Object.values(PROMOTION_STAGES).includes(requested)){
    blockers.push(issue("REQUESTED_STAGE_INVALID", {requested}));
  }

  if (current === "SHADOW" && requested === "GATED_ENFORCEMENT"){
    blockers.push(issue("DIRECT_SHADOW_TO_ENFORCEMENT_FORBIDDEN"));
  }

  if (
    NEXT_STAGE[current] &&
    requested &&
    requested !== NEXT_STAGE[current]
  ){
    blockers.push(issue("NON_SEQUENTIAL_TRANSITION_FORBIDDEN", {
      current,
      requested,
      expected:NEXT_STAGE[current]
    }));
  }

  if (current === requested){
    blockers.push(issue("NOOP_TRANSITION", {current}, false));
  }

  const reviewReady = compositeReview?.status === "READY_FOR_HUMAN_REVIEW" &&
    compositeReview?.promotion_candidate === true &&
    compositeReview?.automatic_promotion === false &&
    compositeReview?.human_review_required === true;

  if (!reviewReady){
    blockers.push(issue("COMPOSITE_REVIEW_NOT_READY", {
      status:compositeReview?.status || null
    }));
  }

  const approved = manualApproval?.approved === true;
  const approver = nonEmpty(manualApproval?.approved_by);
  const ticket = nonEmpty(manualApproval?.change_ticket);

  if (!approved || !approver || !ticket){
    blockers.push(issue("MANUAL_APPROVAL_INCOMPLETE", {
      approved,
      approver_present:approver,
      change_ticket_present:ticket
    }));
  }

  if (requested === "GATED_ENFORCEMENT"){
    const knownOutcomes = Number(advisoryEvidence?.known_outcomes || 0);
    const incidents = Number(advisoryEvidence?.incident_count || 0);
    const regressions = Number(advisoryEvidence?.regression_count || 0);
    const statisticalStatus = String(advisoryEvidence?.statistical_status || "").toUpperCase();
    const consistencyStatus = String(advisoryEvidence?.consistency_status || "").toUpperCase();
    const maxTrafficPct = percent(canary?.max_traffic_pct);
    const allowlist = Array.isArray(canary?.scope_allowlist) ? canary.scope_allowlist : [];

    if (knownOutcomes < 100){
      blockers.push(issue("INSUFFICIENT_ADVISORY_OBSERVATIONS", {
        known_outcomes:knownOutcomes,
        minimum:100
      }));
    }
    if (incidents > 0){
      blockers.push(issue("ADVISORY_INCIDENTS_PRESENT", {incident_count:incidents}));
    }
    if (regressions > 0){
      blockers.push(issue("ADVISORY_REGRESSIONS_PRESENT", {regression_count:regressions}));
    }
    if (statisticalStatus !== "FALSE_BLOCK_BOUND_SUPPORTED"){
      blockers.push(issue("ADVISORY_STATISTICAL_SUPPORT_MISSING", {
        status:advisoryEvidence?.statistical_status || null
      }));
    }
    if (consistencyStatus !== "CONSISTENT"){
      blockers.push(issue("ADVISORY_CONSISTENCY_NOT_CONFIRMED", {
        status:advisoryEvidence?.consistency_status || null
      }));
    }
    if (maxTrafficPct === null || maxTrafficPct <= 0 || maxTrafficPct > 5){
      blockers.push(issue("CANARY_TRAFFIC_LIMIT_INVALID", {
        max_traffic_pct:canary?.max_traffic_pct ?? null,
        maximum:5
      }));
    }
    if (!allowlist.length){
      blockers.push(issue("CANARY_SCOPE_ALLOWLIST_REQUIRED"));
    }
    if (canary?.rollback_defined !== true){
      blockers.push(issue("CANARY_ROLLBACK_NOT_DEFINED"));
    }
  }

  const hardBlockers = blockers.filter(x => x.hard);
  const status = hardBlockers.length ? "DESIGN_BLOCKED" : "DESIGN_ELIGIBLE";

  return {
    contract:CONTROLLED_PROMOTION_CONTRACT,
    vertical:v,
    current_stage:current,
    requested_stage:requested,
    status,
    design_eligible:status === "DESIGN_ELIGIBLE",
    execution_permitted:false,
    activation_requested:false,
    automatic_promotion:false,
    human_review_required:true,
    blockers,
    hard_blockers:hardBlockers,
    effects:{
      advisory:[...profile.advisory_effects],
      future_gated:[...profile.future_gated_effects],
      forbidden:[...profile.forbidden_effects],
      active:[]
    },
    canary_design:requested === "GATED_ENFORCEMENT" ? {
      max_traffic_pct:percent(canary?.max_traffic_pct),
      scope_allowlist:Array.isArray(canary?.scope_allowlist) ? [...canary.scope_allowlist] : [],
      rollback_defined:canary?.rollback_defined === true
    } : null
  };
}

export function evaluateRollbackDesign({
  vertical,
  currentStage,
  signals = {}
} = {}){
  const v = String(vertical || "").toLowerCase();
  const current = String(currentStage || "").toUpperCase();
  const triggers = [];

  if (Number(signals.risk_relaxations || 0) > 0){
    triggers.push("RISK_RELAXATION_PRESENT");
  }
  if (String(signals.statistical_status || "").toUpperCase() !== "FALSE_BLOCK_BOUND_SUPPORTED"){
    triggers.push("STATISTICAL_SUPPORT_LOST");
  }
  if (String(signals.consistency_status || "").toUpperCase() !== "CONSISTENT"){
    triggers.push("CROSS_VERTICAL_INCONSISTENT");
  }
  if (signals.ci_green === false){
    triggers.push("CI_NOT_GREEN");
  }
  if (signals.evidence_verified === false){
    triggers.push("EVIDENCE_NOT_VERIFIED");
  }
  if (Number(signals.incident_count || 0) > 0){
    triggers.push("INCIDENT_PRESENT");
  }
  if (Number(signals.regression_count || 0) > 0){
    triggers.push("REGRESSION_PRESENT");
  }

  return {
    contract:"agentos.controlled_promotion_rollback_design.v1",
    vertical:v,
    current_stage:current,
    rollback_required:triggers.length > 0,
    rollback_target:"SHADOW",
    triggers,
    execution_permitted:false,
    automatic_rollback:false,
    human_review_required:true
  };
}
