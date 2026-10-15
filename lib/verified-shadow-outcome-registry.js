const RANK = {
  PUBLISH:0,
  REVIEW:1,
  BLOCK:2
};

export const SHADOW_OUTCOME_CONTRACT = "agentos.shadow_outcome.v1";

function normalizeDecision(value){
  const v = String(value || "REVIEW").toUpperCase();
  if (["PUBLISH","PUBLISHED","GO","ALLOW"].includes(v)) return "PUBLISH";
  if (["BLOCK","BLOCKED","REJECT","REJECTED"].includes(v)) return "BLOCK";
  return "REVIEW";
}

function normalizeOutcome(value){
  const v = String(value || "UNKNOWN").toUpperCase();
  if (["GOOD","POSITIVE","SAFE","VALID","SUCCESS"].includes(v)) return "GOOD";
  if (["BAD","NEGATIVE","UNSAFE","INVALID","FAILURE"].includes(v)) return "BAD";
  if (["NEUTRAL","MIXED"].includes(v)) return "NEUTRAL";
  return "UNKNOWN";
}

export function classifyShadowOutcome({
  decisionId,
  outcomeId = null,
  baselineDecision,
  shadowDecision,
  outcome = "UNKNOWN",
  vertical = "unknown",
  mode = "shadow"
} = {}){
  const baseline = normalizeDecision(baselineDecision);
  const shadow = normalizeDecision(shadowDecision);
  const normalizedOutcome = normalizeOutcome(outcome);
  const baselineRank = RANK[baseline];
  const shadowRank = RANK[shadow];

  const diverged = baselineRank !== shadowRank;
  const stricter = shadowRank > baselineRank;
  const relaxed = shadowRank < baselineRank;
  const wouldBlock = shadow === "BLOCK" && baseline !== "BLOCK";
  const knownOutcome = normalizedOutcome !== "UNKNOWN";

  let eventType = null;
  if (relaxed){
    eventType = "RISK_RELAXATION";
  } else if (wouldBlock && knownOutcome && normalizedOutcome === "BAD"){
    eventType = "SAFETY_CATCH";
  } else if (wouldBlock && knownOutcome && normalizedOutcome === "GOOD"){
    eventType = "FALSE_BLOCK";
  }

  return {
    contract:SHADOW_OUTCOME_CONTRACT,
    decision_id:String(decisionId || ""),
    outcome_id:outcomeId === null ? null : String(outcomeId),
    vertical:String(vertical || "unknown"),
    mode:String(mode || "shadow"),
    baseline_decision:baseline,
    shadow_decision:shadow,
    outcome:normalizedOutcome,
    known_outcome:knownOutcome,
    diverged,
    stricter,
    would_block:wouldBlock,
    risk_relaxation:relaxed,
    event_type:eventType
  };
}

export function summarizeShadowOutcomes(records = []){
  const items = records.map(classifyShadowOutcome);
  const known = items.filter(item => item.known_outcome);
  const knownWouldBlock = items.filter(item => item.known_outcome && item.would_block);
  const safetyCatches = items.filter(item => item.event_type === "SAFETY_CATCH").length;
  const falseBlocks = items.filter(item => item.event_type === "FALSE_BLOCK").length;
  const riskRelaxations = items.filter(item => item.event_type === "RISK_RELAXATION").length;
  const divergences = items.filter(item => item.diverged).length;

  return {
    contract:SHADOW_OUTCOME_CONTRACT,
    total_count:items.length,
    known_outcome_count:known.length,
    unknown_outcome_count:items.length - known.length,
    divergence_count:divergences,
    safety_catch_count:safetyCatches,
    false_block_count:falseBlocks,
    risk_relaxation_count:riskRelaxations,
    known_would_block_count:knownWouldBlock.length,
    false_block_rate:knownWouldBlock.length
      ? falseBlocks / knownWouldBlock.length
      : null,
    promotion_blockers:{
      risk_relaxation:riskRelaxations > 0,
      false_block:falseBlocks > 0,
      insufficient_known_outcomes:known.length === 0
    },
    records:items
  };
}
