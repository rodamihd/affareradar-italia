import crypto from "node:crypto";

export const LIMITED_ENFORCEMENT_CONTRACT = "agentos.limited_enforcement_canary.v1";

const PROFILES = Object.freeze({
  affareradar:{
    allowed_stage:"ADVISORY",
    allowed_effects:["ROUTE_TO_REVIEW","HOLD_BEFORE_PUBLISH"],
    safe_fallback:"PUBLISH"
  },
  quotai:{
    allowed_stage:"ADVISORY",
    allowed_effects:["DOWNGRADE_TO_WATCH","REQUIRE_HUMAN_CONFIRMATION"],
    safe_fallback:"PLAY"
  },
  sceltasemplice:{
    allowed_stage:"CONTRACT_ONLY",
    allowed_effects:[],
    safe_fallback:"PROPOSE"
  }
});

function hashBucket(value){
  const hex = crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0,8);
  return parseInt(hex, 16) % 10000;
}

function pct(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function blocker(code, detail = null, hard = true){
  return {code, detail, hard};
}

export function assessCanaryActivation({
  vertical,
  currentStage,
  compositeReview = {},
  promotionDesign = {},
  evidence = {},
  ciGreen = false,
  evidenceVerified = false,
  riskRelaxations = 0,
  manualApproval = {},
  canary = {}
} = {}){
  const v = String(vertical || "").toLowerCase();
  const profile = PROFILES[v];
  const blockers = [];

  if (!profile){
    return {
      contract:LIMITED_ENFORCEMENT_CONTRACT,
      vertical:v || "unknown",
      status:"CANARY_BLOCKED",
      activation_permitted:false,
      automatic_promotion:false,
      blockers:[blocker("UNKNOWN_VERTICAL")]
    };
  }

  if (v === "sceltasemplice"){
    blockers.push(blocker("CONTRACT_ONLY_NOT_ENFORCEMENT_ELIGIBLE"));
  }

  const stage = String(currentStage || "").toUpperCase();
  if (stage !== profile.allowed_stage){
    blockers.push(blocker("ADVISORY_STAGE_REQUIRED", {
      current_stage:stage || null,
      required_stage:profile.allowed_stage
    }));
  }

  if (
    compositeReview?.status !== "READY_FOR_HUMAN_REVIEW" ||
    compositeReview?.promotion_candidate !== true
  ){
    blockers.push(blocker("COMPOSITE_REVIEW_NOT_READY", {
      status:compositeReview?.status || null
    }));
  }

  if (
    promotionDesign?.status !== "DESIGN_ELIGIBLE" ||
    promotionDesign?.requested_stage !== "GATED_ENFORCEMENT"
  ){
    blockers.push(blocker("CONTROLLED_PROMOTION_DESIGN_NOT_ELIGIBLE", {
      status:promotionDesign?.status || null,
      requested_stage:promotionDesign?.requested_stage || null
    }));
  }

  if (String(evidence?.source || "").toLowerCase() !== "real"){
    blockers.push(blocker("REAL_EVIDENCE_REQUIRED", {
      source:evidence?.source || null
    }));
  }

  if (Number(evidence?.known_outcomes || 0) < 100){
    blockers.push(blocker("INSUFFICIENT_REAL_ADVISORY_OUTCOMES", {
      known_outcomes:Number(evidence?.known_outcomes || 0),
      minimum:100
    }));
  }

  if (String(evidence?.statistical_status || "").toUpperCase() !== "FALSE_BLOCK_BOUND_SUPPORTED"){
    blockers.push(blocker("STATISTICAL_SUPPORT_REQUIRED", {
      status:evidence?.statistical_status || null
    }));
  }

  if (String(evidence?.consistency_status || "").toUpperCase() !== "CONSISTENT"){
    blockers.push(blocker("CROSS_VERTICAL_CONSISTENCY_REQUIRED", {
      status:evidence?.consistency_status || null
    }));
  }

  if (Number(evidence?.incident_count || 0) > 0){
    blockers.push(blocker("INCIDENTS_PRESENT", {
      incident_count:Number(evidence.incident_count)
    }));
  }

  if (Number(evidence?.regression_count || 0) > 0){
    blockers.push(blocker("REGRESSIONS_PRESENT", {
      regression_count:Number(evidence.regression_count)
    }));
  }

  if (!ciGreen){
    blockers.push(blocker("CI_NOT_GREEN"));
  }

  if (!evidenceVerified){
    blockers.push(blocker("EVIDENCE_NOT_VERIFIED"));
  }

  if (Number(riskRelaxations || 0) !== 0){
    blockers.push(blocker("RISK_RELAXATION_PRESENT", {
      count:Number(riskRelaxations || 0)
    }));
  }

  if (
    manualApproval?.approved !== true ||
    !String(manualApproval?.approved_by || "").trim() ||
    !String(manualApproval?.change_ticket || "").trim()
  ){
    blockers.push(blocker("MANUAL_APPROVAL_INCOMPLETE"));
  }

  const maxTrafficPct = pct(canary?.max_traffic_pct);
  if (maxTrafficPct === null || maxTrafficPct <= 0 || maxTrafficPct > 5){
    blockers.push(blocker("CANARY_TRAFFIC_LIMIT_INVALID", {
      max_traffic_pct:canary?.max_traffic_pct ?? null,
      maximum:5
    }));
  }

  const allowlist = Array.isArray(canary?.scope_allowlist)
    ? canary.scope_allowlist.map(x => String(x))
    : [];
  if (!allowlist.length){
    blockers.push(blocker("CANARY_SCOPE_ALLOWLIST_REQUIRED"));
  }

  if (canary?.rollback_defined !== true){
    blockers.push(blocker("ROLLBACK_PLAN_REQUIRED"));
  }

  const hardBlockers = blockers.filter(x => x.hard);
  const status = hardBlockers.length ? "CANARY_BLOCKED" : "CANARY_ELIGIBLE";

  return {
    contract:LIMITED_ENFORCEMENT_CONTRACT,
    vertical:v,
    status,
    activation_permitted:status === "CANARY_ELIGIBLE",
    automatic_promotion:false,
    human_review_required:true,
    blockers,
    hard_blockers:hardBlockers,
    limits:{
      max_traffic_pct:maxTrafficPct,
      scope_allowlist:allowlist,
      rollback_defined:canary?.rollback_defined === true
    },
    allowed_effects:[...profile.allowed_effects]
  };
}

export function applyLimitedEnforcement({
  activation = {},
  decision = {},
  riskClass
} = {}){
  const v = String(activation?.vertical || "").toLowerCase();
  const profile = PROFILES[v];

  if (
    !profile ||
    activation?.status !== "CANARY_ELIGIBLE" ||
    activation?.activation_permitted !== true
  ){
    return {
      applied:false,
      reason:"CANARY_NOT_ELIGIBLE",
      effect:null,
      decision:decision.baseline_decision || profile?.safe_fallback || null
    };
  }

  const allowlist = activation?.limits?.scope_allowlist || [];
  if (!allowlist.includes(String(riskClass || ""))){
    return {
      applied:false,
      reason:"OUTSIDE_SCOPE_ALLOWLIST",
      effect:null,
      decision:decision.baseline_decision || profile.safe_fallback
    };
  }

  const trafficPct = Number(activation?.limits?.max_traffic_pct || 0);
  const bucket = hashBucket(decision.decision_id);
  const selected = bucket < Math.floor(trafficPct * 100);

  if (!selected){
    return {
      applied:false,
      reason:"OUTSIDE_CANARY_SAMPLE",
      effect:null,
      decision:decision.baseline_decision || profile.safe_fallback,
      bucket
    };
  }

  const baseline = String(decision.baseline_decision || "").toUpperCase();
  const shadow = String(decision.shadow_decision || decision.backport_decision || "").toUpperCase();

  if (v === "affareradar"){
    if (baseline === "PUBLISH" && ["REVIEW","BLOCK"].includes(shadow)){
      return {
        applied:true,
        reason:"LIMITED_REVIEW_HOLD",
        effect:"ROUTE_TO_REVIEW",
        decision:"REVIEW",
        bucket
      };
    }
  }

  if (v === "quotai"){
    if (baseline === "PLAY" && ["WATCH","REJECT"].includes(shadow)){
      return {
        applied:true,
        reason:"LIMITED_DOWNGRADE_TO_WATCH",
        effect:"DOWNGRADE_TO_WATCH",
        decision:"WATCH",
        bucket
      };
    }
  }

  return {
    applied:false,
    reason:"NO_SAFE_LIMITED_EFFECT",
    effect:null,
    decision:baseline || profile.safe_fallback,
    bucket
  };
}

export function assessCanaryRollback({
  activation = {},
  observed = {}
} = {}){
  const triggers = [];

  if (activation?.status !== "CANARY_ELIGIBLE"){
    triggers.push("ACTIVATION_NOT_ELIGIBLE");
  }
  if (Number(observed?.risk_relaxations || 0) > 0){
    triggers.push("RISK_RELAXATION_PRESENT");
  }
  if (Number(observed?.incident_count || 0) > 0){
    triggers.push("INCIDENT_PRESENT");
  }
  if (Number(observed?.regression_count || 0) > 0){
    triggers.push("REGRESSION_PRESENT");
  }
  if (String(observed?.statistical_status || "").toUpperCase() !== "FALSE_BLOCK_BOUND_SUPPORTED"){
    triggers.push("STATISTICAL_SUPPORT_LOST");
  }
  if (String(observed?.consistency_status || "").toUpperCase() !== "CONSISTENT"){
    triggers.push("CROSS_VERTICAL_INCONSISTENT");
  }
  if (observed?.ci_green === false){
    triggers.push("CI_NOT_GREEN");
  }
  if (observed?.evidence_verified === false){
    triggers.push("EVIDENCE_NOT_VERIFIED");
  }

  return {
    contract:"agentos.limited_enforcement_rollback.v1",
    rollback_required:triggers.length > 0,
    rollback_target:"SHADOW",
    triggers,
    automatic_rollback:false,
    human_review_required:true
  };
}
