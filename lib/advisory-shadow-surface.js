export const ADVISORY_SURFACE_CONTRACT = "agentos.advisory_surface.v1";

function normalizeVertical(value){
  return String(value || "unknown").toLowerCase();
}

function normalizeDecision(value){
  return String(value || "UNKNOWN").toUpperCase();
}

export function buildAdvisorySurface({
  shadowRecord = {},
  statistical = null,
  compositeReview = null,
  observedOutcome = null
} = {}){
  const vertical = normalizeVertical(shadowRecord.vertical);
  const baseline = normalizeDecision(shadowRecord.baseline_decision);
  const shadow = normalizeDecision(
    shadowRecord.shadow_decision ?? shadowRecord.backport_decision
  );
  const diverged = shadowRecord.diverged === true || baseline !== shadow;

  const reasons = Array.isArray(shadowRecord.reasons)
    ? shadowRecord.reasons.map(String)
    : [];

  return {
    contract:ADVISORY_SURFACE_CONTRACT,
    vertical,
    mode:"advisory",
    decision_id:String(shadowRecord.decision_id || shadowRecord.event_id || ""),
    baseline_decision:baseline,
    advisory_decision:shadow,
    diverged,
    reasons,
    evidence:{
      contract:shadowRecord.evidence_contract || null,
      hash_version:shadowRecord.evidence_hash_version || null,
      hash:shadowRecord.evidence_hash || null,
      verified:Boolean(shadowRecord.evidence_hash)
    },
    statistical:statistical ? {
      status:statistical.status || null,
      confidence:statistical.confidence ?? null,
      quality_outcome:statistical.quality_outcome || null
    } : null,
    composite_review:compositeReview ? {
      status:compositeReview.status || null,
      promotion_candidate:compositeReview.promotion_candidate === true
    } : null,
    observed_outcome:observedOutcome || null,
    human_action_required:diverged,
    enforcement:false,
    production_mutation:false,
    publish_effect:false,
    wager_effect:false,
    tariff_effect:false,
    automatic_promotion:false
  };
}

export function summarizeAdvisoryObservations(rows = []){
  const items = rows.map(row => buildAdvisorySurface(row));
  return {
    contract:"agentos.advisory_observation_summary.v1",
    total:items.length,
    diverged:items.filter(x => x.diverged).length,
    human_action_required:items.filter(x => x.human_action_required).length,
    enforcement_count:0,
    production_mutation_count:0,
    automatic_promotion:false,
    items
  };
}
