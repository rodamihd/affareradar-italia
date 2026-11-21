export const PROMOTION_READINESS_CONTRACT = "agentos.promotion_readiness.v1";

export const DEFAULT_PROMOTION_THRESHOLDS = Object.freeze({
  min_known_outcomes: 50,
  min_known_would_block: 20,
  max_false_block_rate: 0.05,
  max_risk_relaxations: 0,
  require_ci_green: true,
  require_verified_evidence: true
});

function finiteNumber(value, fallback = 0){
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value){
  return value === true;
}

export function assessPromotionReadiness({
  summary = {},
  ciGreen = false,
  evidenceVerified = false,
  thresholds = {}
} = {}){
  const t = { ...DEFAULT_PROMOTION_THRESHOLDS, ...thresholds };

  const knownOutcomes = finiteNumber(summary.known_outcome_count);
  const knownWouldBlock = finiteNumber(summary.known_would_block_count);
  const falseBlocks = finiteNumber(summary.false_block_count);
  const riskRelaxations = finiteNumber(summary.risk_relaxation_count);
  const falseBlockRate = summary.false_block_rate === null || summary.false_block_rate === undefined
    ? null
    : finiteNumber(summary.false_block_rate, null);

  const blockers = [];

  if (t.require_ci_green && !bool(ciGreen)){
    blockers.push("CI_NOT_GREEN");
  }

  if (t.require_verified_evidence && !bool(evidenceVerified)){
    blockers.push("EVIDENCE_NOT_VERIFIED");
  }

  if (riskRelaxations > t.max_risk_relaxations){
    blockers.push("RISK_RELAXATION_PRESENT");
  }

  if (knownOutcomes < t.min_known_outcomes){
    blockers.push("INSUFFICIENT_KNOWN_OUTCOMES");
  }

  if (knownWouldBlock < t.min_known_would_block){
    blockers.push("INSUFFICIENT_WOULD_BLOCK_EVIDENCE");
  }

  if (falseBlockRate === null){
    blockers.push("FALSE_BLOCK_RATE_UNKNOWN");
  } else if (falseBlockRate > t.max_false_block_rate){
    blockers.push("FALSE_BLOCK_RATE_TOO_HIGH");
  }

  const hardBlockers = blockers.filter(item =>
    ["CI_NOT_GREEN","EVIDENCE_NOT_VERIFIED","RISK_RELAXATION_PRESENT","FALSE_BLOCK_RATE_TOO_HIGH"].includes(item)
  );

  let status = "READY_FOR_HUMAN_REVIEW";
  if (hardBlockers.length){
    status = "NOT_READY";
  } else if (blockers.length){
    status = "REVIEW";
  }

  return {
    contract:PROMOTION_READINESS_CONTRACT,
    status,
    automatic_promotion:false,
    human_review_required:true,
    blockers,
    hard_blockers:hardBlockers,
    metrics:{
      known_outcomes:knownOutcomes,
      known_would_block:knownWouldBlock,
      false_blocks:falseBlocks,
      false_block_rate:falseBlockRate,
      risk_relaxations:riskRelaxations,
      ci_green:bool(ciGreen),
      evidence_verified:bool(evidenceVerified)
    },
    thresholds:t
  };
}
