function byDecisionId(rows = []){
  const map = new Map();
  for (const row of rows){
    const id = String(row?.decisionId || row?.decision_id || "").trim();
    if (id) map.set(id, row);
  }
  return map;
}

function normalizeQualityOutcome(value){
  const v = String(value || "UNKNOWN").toUpperCase();
  if (["GOOD","POSITIVE","SAFE","VALID","SUCCESS"].includes(v)) return "GOOD";
  if (["BAD","NEGATIVE","UNSAFE","INVALID","FAILURE"].includes(v)) return "BAD";
  if (["NEUTRAL","MIXED"].includes(v)) return "NEUTRAL";
  return "UNKNOWN";
}

export function joinAffareRadarRealOutcomes({
  shadowRecords = [],
  recentDecisions = [],
  recentOutcomes = []
} = {}){
  const decisions = byDecisionId(recentDecisions);
  const outcomes = byDecisionId(recentOutcomes);
  const joined = [];
  const unresolved = [];

  for (const shadow of shadowRecords){
    const decisionId = String(shadow?.decision_id || shadow?.event_id || "").trim();
    if (!decisionId){
      unresolved.push({ reason:"SHADOW_DECISION_ID_MISSING", shadow });
      continue;
    }

    const production = decisions.get(decisionId) || null;
    const realOutcome = outcomes.get(decisionId) || null;

    if (!production){
      unresolved.push({ decision_id:decisionId, reason:"PRODUCTION_DECISION_NOT_FOUND" });
      continue;
    }

    const outcomeLabel = normalizeQualityOutcome(
      realOutcome?.qualityOutcome ??
      realOutcome?.quality_outcome ??
      realOutcome?.outcome
    );

    joined.push({
      vertical:"affareradar",
      mode:"shadow",
      decision_id:decisionId,
      outcome_id:realOutcome?.outcomeId || realOutcome?.outcome_id || null,
      baseline_decision:shadow.baseline_decision || production.action || production.decisionAction,
      shadow_decision:shadow.backport_decision || shadow.shadow_decision,
      outcome:outcomeLabel,
      evidence_contract:shadow.evidence_contract,
      evidence_hash_version:shadow.evidence_hash_version,
      evidence_hash:shadow.evidence_hash,
      real_outcome_present:Boolean(realOutcome),
      quality_outcome_known:outcomeLabel !== "UNKNOWN",
      source_metrics:realOutcome ? {
        impressions:Number(realOutcome.impressions || 0),
        clicks:Number(realOutcome.clicks || 0),
        conversions:Number(realOutcome.conversions || 0),
        revenueEUR:Number(realOutcome.revenueEUR || 0),
        publishes:Number(realOutcome.publishes || 0),
        successfulPublishes:Number(realOutcome.successfulPublishes || 0)
      } : null
    });
  }

  return {
    joined,
    unresolved,
    joined_count:joined.length,
    unresolved_count:unresolved.length,
    known_quality_outcome_count:joined.filter(x => x.quality_outcome_known).length
  };
}
