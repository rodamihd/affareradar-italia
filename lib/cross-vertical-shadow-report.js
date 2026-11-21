import { summarizeShadowOutcomes } from "./verified-shadow-outcome-registry.js";
import { assessPromotionReadiness } from "./promotion-readiness-gate.js";

export const CROSS_VERTICAL_REPORT_CONTRACT = "agentos.cross_vertical_shadow_report.v1";

const PROMOTION_ELIGIBLE_MODES = new Set(["shadow", "live_real", "oos"]);

function validHash(value){
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function normalizedRecord(input = {}){
  const vertical = String(input.vertical || "unknown").toLowerCase();
  const mode = String(input.mode || "shadow").toLowerCase();
  const decisionId = String(input.decision_id || input.decisionId || "");
  const outcomeIdRaw = input.outcome_id ?? input.outcomeId ?? null;

  return {
    decisionId,
    outcomeId: outcomeIdRaw === null ? null : String(outcomeIdRaw),
    baselineDecision: input.baseline_decision ?? input.baselineDecision,
    shadowDecision: input.shadow_decision ?? input.shadowDecision ?? input.backport_decision,
    outcome: input.outcome ?? "UNKNOWN",
    vertical,
    mode,
    evidence_contract: input.evidence_contract || null,
    evidence_hash_version: input.evidence_hash_version || null,
    evidence_hash: input.evidence_hash || null,
    evidence_verified:
      input.evidence_contract === "agentos.verified_evidence.v1" &&
      String(input.evidence_hash_version || "") === "2" &&
      validHash(input.evidence_hash),
    promotion_eligible_mode: PROMOTION_ELIGIBLE_MODES.has(mode)
  };
}

function summarizeGroup(records, { ciGreen = false } = {}){
  const normalized = records.map(normalizedRecord);
  const eligible = normalized.filter(r => r.promotion_eligible_mode);
  const contractOnly = normalized.filter(r => r.mode === "contract_only");

  const outcomeInput = eligible.map(r => ({
    decisionId:r.decisionId,
    outcomeId:r.outcomeId,
    baselineDecision:r.baselineDecision,
    shadowDecision:r.shadowDecision,
    outcome:r.outcome,
    vertical:r.vertical,
    mode:r.mode
  }));

  const outcomeSummary = summarizeShadowOutcomes(outcomeInput);
  const verifiedEligible = eligible.filter(r => r.evidence_verified).length;
  const evidenceVerified =
    eligible.length > 0 &&
    verifiedEligible === eligible.length;

  const readiness = assessPromotionReadiness({
    summary:outcomeSummary,
    ciGreen,
    evidenceVerified
  });

  return {
    total_records:normalized.length,
    promotion_eligible_records:eligible.length,
    contract_only_records:contractOnly.length,
    verified_evidence_records:normalized.filter(r => r.evidence_verified).length,
    unverified_evidence_records:normalized.filter(r => !r.evidence_verified).length,
    outcomes:outcomeSummary,
    readiness,
    records:normalized
  };
}

export function buildCrossVerticalShadowReport(records = [], {
  ci = {}
} = {}){
  const normalized = records.map(normalizedRecord);
  const verticals = [...new Set(normalized.map(r => r.vertical))].sort();
  const byVertical = {};

  for (const vertical of verticals){
    byVertical[vertical] = summarizeGroup(
      normalized.filter(r => r.vertical === vertical),
      { ciGreen:ci[vertical] === true }
    );
  }

  const aggregateEligible = normalized.filter(r => r.promotion_eligible_mode);
  const aggregate = summarizeGroup(aggregateEligible, {
    ciGreen:
      verticals
        .filter(v => byVertical[v].promotion_eligible_records > 0)
        .every(v => ci[v] === true)
  });

  return {
    contract:CROSS_VERTICAL_REPORT_CONTRACT,
    generated_from_records:normalized.length,
    vertical_count:verticals.length,
    verticals:byVertical,
    aggregate,
    contract_only_excluded_from_promotion:true
  };
}
