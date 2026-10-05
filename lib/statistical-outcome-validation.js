import { dealPerformanceScore } from "./deal-performance-score.js";
import { continuousEdgeValidation } from "./continuous-edge-validation.js";

export const STATISTICAL_OUTCOME_CONTRACT = "agentos.statistical_outcome_validation.v1";

const TRUSTED_EXPLICIT_SOURCES = new Set([
  "human_verified",
  "audited",
  "ground_truth",
  "manual_review"
]);

const EVIDENCE_RANK = {
  insufficient:0,
  low:1,
  medium:2,
  high:3
};

function explicitLabel(value){
  const v = String(value || "UNKNOWN").toUpperCase();
  if (["GOOD","POSITIVE","SAFE","VALID","SUCCESS"].includes(v)) return "GOOD";
  if (["BAD","NEGATIVE","UNSAFE","INVALID","FAILURE"].includes(v)) return "BAD";
  if (["NEUTRAL","MIXED"].includes(v)) return "NEUTRAL";
  return "UNKNOWN";
}

function evidenceAtLeast(actual, minimum){
  return (EVIDENCE_RANK[actual] ?? 0) >= (EVIDENCE_RANK[minimum] ?? 2);
}

function confidenceFor(evidence, familyCount, critical = false){
  if (critical) return evidenceAtLeast(evidence, "medium") ? 0.95 : 0.85;
  const base = evidence === "high" ? 0.80 : evidence === "medium" ? 0.68 : 0.45;
  return Math.min(0.97, Number((base + Math.max(0, familyCount - 1) * 0.08).toFixed(2)));
}

export function validateAffareRadarOutcome(decision = {}, outcome = {}, {
  minEvidence = "medium"
} = {}){
  const explicit = explicitLabel(
    outcome.qualityOutcome ?? outcome.quality_outcome ?? outcome.outcome
  );
  const explicitSource = String(
    outcome.qualityOutcomeSource ?? outcome.quality_outcome_source ?? ""
  ).toLowerCase();

  if (explicit !== "UNKNOWN" && TRUSTED_EXPLICIT_SOURCES.has(explicitSource)){
    return {
      contract:STATISTICAL_OUTCOME_CONTRACT,
      vertical:"affareradar",
      status:"VALIDATED",
      quality_outcome:explicit,
      confidence:1,
      basis:"trusted_explicit_ground_truth",
      evidence:"ground_truth",
      positive_families:[],
      negative_families:[],
      signals:[{family:"ground_truth", direction:"explicit", reason:explicitSource}]
    };
  }

  const performance = dealPerformanceScore(outcome, { priorScore:50 });
  const edge = continuousEdgeValidation(decision, outcome);
  const evidence = performance.evidence;
  const positive = new Set();
  const negative = new Set();
  const signals = [];

  if (performance.score >= 70){
    positive.add("behavior");
    signals.push({family:"behavior", direction:"positive", reason:"performance_score_high", value:performance.score});
  } else if (performance.score <= 35){
    negative.add("behavior");
    signals.push({family:"behavior", direction:"negative", reason:"performance_score_low", value:performance.score});
  }

  if (edge.verdict === "EDGE_SUPPORTED"){
    positive.add("calibration");
    signals.push({family:"calibration", direction:"positive", reason:"edge_supported", value:edge.edgeCaptureScore});
  } else if (edge.verdict === "EDGE_NOT_CAPTURED"){
    negative.add("calibration");
    signals.push({family:"calibration", direction:"negative", reason:"edge_not_captured", value:edge.edgeCaptureScore});
  }

  const falseDeal = outcome.falseDeal === true || outcome.false_deal === true;
  const retracted = outcome.retracted === true || outcome.retraction === true;
  const invalidated = outcome.invalidated === true || outcome.offerInvalidated === true;
  const priceFailed = outcome.pricePersisted === false || outcome.price_persisted === false;
  const couponFailed = outcome.couponValid === false || outcome.coupon_valid === false;

  const criticalReasons = [];
  if (falseDeal) criticalReasons.push("false_deal");
  if (retracted) criticalReasons.push("retracted");
  if (invalidated) criticalReasons.push("invalidated");
  if (priceFailed) criticalReasons.push("price_not_persisted");
  if (couponFailed) criticalReasons.push("coupon_invalid");

  if (criticalReasons.length){
    negative.add("validity");
    for (const reason of criticalReasons){
      signals.push({family:"validity", direction:"negative", reason});
    }
  } else if (
    outcome.pricePersisted === true ||
    outcome.price_persisted === true ||
    outcome.couponValid === true ||
    outcome.coupon_valid === true
  ){
    positive.add("validity");
    signals.push({family:"validity", direction:"positive", reason:"offer_validity_confirmed"});
  }

  const sufficient = evidenceAtLeast(evidence, minEvidence);
  let quality = "UNKNOWN";
  let status = sufficient ? "INCONCLUSIVE" : "INSUFFICIENT_EVIDENCE";
  let basis = "insufficient_or_conflicting_signals";
  let confidence = 0;

  if (criticalReasons.length){
    quality = "BAD";
    status = "VALIDATED";
    basis = "critical_validity_failure";
    confidence = confidenceFor(evidence, negative.size, true);
  } else if (sufficient && positive.size >= 2 && negative.size === 0){
    quality = "GOOD";
    status = "VALIDATED";
    basis = "multi_family_positive_agreement";
    confidence = confidenceFor(evidence, positive.size);
  } else if (sufficient && negative.size >= 2 && positive.size === 0){
    quality = "BAD";
    status = "VALIDATED";
    basis = "multi_family_negative_agreement";
    confidence = confidenceFor(evidence, negative.size);
  } else if (sufficient && positive.size > 0 && negative.size > 0){
    quality = "NEUTRAL";
    status = "INCONCLUSIVE";
    basis = "conflicting_signal_families";
    confidence = 0.5;
  }

  return {
    contract:STATISTICAL_OUTCOME_CONTRACT,
    vertical:"affareradar",
    status,
    quality_outcome:quality,
    confidence,
    basis,
    evidence,
    positive_families:[...positive].sort(),
    negative_families:[...negative].sort(),
    signals,
    performance,
    edge,
    explicit_untrusted_label:explicit !== "UNKNOWN" ? explicit : null,
    explicit_source:explicitSource || null
  };
}

export function wilsonInterval(successes, trials, z = 1.96){
  const n = Number(trials);
  const x = Number(successes);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(x) || x < 0 || x > n){
    return { lower:null, upper:null };
  }
  const p = x / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n) / denom;
  return {
    lower:Math.max(0, center - margin),
    upper:Math.min(1, center + margin)
  };
}

export function summarizeShadowStatisticalEvidence(rows = [], {
  falseBlockLimit = 0.05,
  minKnownOutcomes = 50,
  minKnownWouldBlock = 20
} = {}){
  const known = rows.filter(r => ["GOOD","BAD"].includes(String(r?.outcome || "").toUpperCase()));
  const wouldBlock = known.filter(r => {
    const baseline = String(r?.baseline_decision || "").toUpperCase();
    const shadow = String(r?.shadow_decision || r?.backport_decision || "").toUpperCase();
    return ["PUBLISH","PLAY"].includes(baseline) && ["BLOCK","REJECT"].includes(shadow);
  });
  const falseBlocks = wouldBlock.filter(r => String(r.outcome).toUpperCase() === "GOOD").length;
  const safetyCatches = wouldBlock.filter(r => String(r.outcome).toUpperCase() === "BAD").length;
  const observedRate = wouldBlock.length ? falseBlocks / wouldBlock.length : null;
  const interval = wilsonInterval(falseBlocks, wouldBlock.length);

  let status = "INSUFFICIENT_SAMPLE";
  if (known.length >= minKnownOutcomes && wouldBlock.length >= minKnownWouldBlock){
    if (interval.upper !== null && interval.upper <= falseBlockLimit){
      status = "FALSE_BLOCK_BOUND_SUPPORTED";
    } else if (observedRate !== null && observedRate > falseBlockLimit){
      status = "FALSE_BLOCK_RATE_TOO_HIGH";
    } else {
      status = "STATISTICALLY_INCONCLUSIVE";
    }
  }

  return {
    contract:"agentos.shadow_statistical_evidence.v1",
    status,
    known_outcomes:known.length,
    known_would_block:wouldBlock.length,
    false_blocks:falseBlocks,
    safety_catches:safetyCatches,
    observed_false_block_rate:observedRate,
    false_block_rate_ci95:interval,
    false_block_limit:falseBlockLimit,
    thresholds:{minKnownOutcomes,minKnownWouldBlock},
    automatic_promotion:false,
    note:"Observed threshold compliance is not equivalent to statistical support; the upper 95% confidence bound must also satisfy the limit."
  };
}
