import { ingestEvidenceRecords } from "./shadow-evidence-ingestion.js";
import { buildCrossVerticalShadowReport } from "./cross-vertical-shadow-report.js";

function pct(value){
  if (value === null || value === undefined) return null;
  return Math.round(Number(value) * 10000) / 100;
}

function progress(current, target){
  if (!target) return null;
  return Math.min(1, Number(current || 0) / Number(target));
}

export function buildShadowValidationDashboard(inputs = [], { ci = {} } = {}){
  const ingestion = ingestEvidenceRecords(inputs);
  const report = buildCrossVerticalShadowReport(ingestion.accepted, { ci });

  const verticals = {};
  for (const [name, data] of Object.entries(report.verticals)){
    const t = data.readiness.thresholds;
    const m = data.readiness.metrics;
    verticals[name] = {
      status:data.readiness.status,
      blockers:data.readiness.blockers,
      records:data.total_records,
      promotion_eligible_records:data.promotion_eligible_records,
      contract_only_records:data.contract_only_records,
      known_outcomes:m.known_outcomes,
      known_outcomes_target:t.min_known_outcomes,
      known_outcomes_progress:progress(m.known_outcomes, t.min_known_outcomes),
      known_would_block:m.known_would_block,
      known_would_block_target:t.min_known_would_block,
      known_would_block_progress:progress(m.known_would_block, t.min_known_would_block),
      false_blocks:m.false_blocks,
      false_block_rate_pct:pct(m.false_block_rate),
      false_block_rate_limit_pct:pct(t.max_false_block_rate),
      risk_relaxations:m.risk_relaxations,
      safety_catches:data.outcomes.safety_catch_count,
      divergences:data.outcomes.divergence_count,
      verified_evidence_records:data.verified_evidence_records,
      unverified_evidence_records:data.unverified_evidence_records
    };
  }

  const agg = report.aggregate;
  return {
    contract:"agentos.shadow_validation_dashboard.v1",
    ingestion:{
      accepted_count:ingestion.accepted_count,
      rejected_count:ingestion.rejected_count,
      duplicate_count:ingestion.duplicate_count
    },
    aggregate:{
      status:agg.readiness.status,
      blockers:agg.readiness.blockers,
      known_outcomes:agg.readiness.metrics.known_outcomes,
      known_would_block:agg.readiness.metrics.known_would_block,
      false_block_rate_pct:pct(agg.readiness.metrics.false_block_rate),
      risk_relaxations:agg.readiness.metrics.risk_relaxations,
      safety_catches:agg.outcomes.safety_catch_count,
      divergences:agg.outcomes.divergence_count
    },
    verticals,
    production_mutation:false,
    automatic_promotion:false
  };
}
