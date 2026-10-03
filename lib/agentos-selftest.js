import { offerDagTemplate, readyDagNodes, scheduleNodeRetry } from "./agentos-dag.js";
import { AGENTOS_PROFILE_VERSION, resolveSignalIntent, freshnessSla, egressGuard } from "./agentos-33_10-profile.js";
import {
  providerCanAttempt,
  providerHealthDefaults,
  recordProviderFailureState,
  recordProviderSuccessState
} from "./provider-health.js";
import { computeSourceReputation } from "./source-reputation.js";
import { predictOfferOutcome } from "./prediction-layer.js";
import { evaluateStockPricePersistence } from "./stock-price-persistence.js";
import { revenueAttributionProfile } from "./revenue-attribution-learning.js";
import { optimizePublishingTime } from "./publishing-time-optimizer.js";
import { adaptiveControl33_10 } from "./agentos-33_10-adaptive-control.js";
import { classifyDecisionEvent } from "./decision-outcome-registry.js";
import { dealPerformanceScore } from "./deal-performance-score.js";
import { assignStrategyArm, championChallengerVerdict } from "./champion-challenger.js";
import { continuousEdgeValidation } from "./continuous-edge-validation.js";
import { profitLearningDecision } from "./profit-learning-controller.js";
import { autonomyPromotionGate } from "./autonomy-promotion-gate.js";

function test(name, fn) {
  try {
    const result = fn();
    return { name, passed:result === true, detail:result === true ? null : String(result) };
  } catch (error) {
    return { name, passed:false, detail:String(error?.message || error) };
  }
}

export function runAgentOsSelfTest(now = Date.UTC(2026, 9, 2, 12, 0, 0)) {
  const tests = [];

  tests.push(test("agentos_profile_version_33_10", () => {
    return AGENTOS_PROFILE_VERSION === "33.10";
  }));

  tests.push(test("dag_verify_ready_after_capture", () => {
    const dag = offerDagTemplate({ asin:"B000TEST00", amazonUrl:"https://www.amazon.it/dp/B000TEST00" }, {}, now);
    const ready = readyDagNodes(dag, now);
    return ready.some(node => node.name === "verify");
  }));

  tests.push(test("dag_retry_backoff", () => {
    const node = { status:"RUNNING", attempts:1, maxAttempts:3, retryBaseSeconds:30, taskId:"t1" };
    const next = scheduleNodeRetry(node, now, "synthetic_failure");
    return next.status === "RETRY_WAIT" && Boolean(next.notBefore) && next.taskId === null;
  }));

  tests.push(test("intent_price_error_candidate", () => {
    const intent = resolveSignalIntent({ title:"Errore prezzo su Amazon", dealType:"price_error", price:"19,99 €" });
    return intent.intent === "PRICE_ERROR_CANDIDATE" && intent.requiresClarification === false;
  }));

  tests.push(test("freshness_creators_verified", () => {
    const fresh = freshnessSla(
      { amazonDataSource:"creators_api", lastVerifiedAt:new Date(now - 2 * 60000).toISOString() },
      { verifiedAt:new Date(now - 2 * 60000).toISOString() },
      now
    );
    return fresh.state === "FRESH";
  }));

  tests.push(test("egress_blocks_unverified_commercial", () => {
    const egress = egressGuard(
      { title:"Deal", price:"9,99 €" },
      {
        policy:{ blocking:[] },
        verification:{ state:"SIGNAL_ONLY" },
        freshness:{ state:"STALE" },
        intent:{ requiresClarification:false },
        publication:{ imageProvenance:{ passed:true } }
      }
    );
    return egress.passed === false &&
      egress.failures.includes("commercial_data_not_amazon_verified") &&
      egress.failures.includes("commercial_data_stale");
  }));

  tests.push(test("provider_circuit_opens_and_recovers", () => {
    let state = providerHealthDefaults("synthetic");
    const threshold = Math.max(1, Number(process.env.AMAZON_PROVIDER_FAILURE_THRESHOLD || 3));
    for (let i = 0; i < threshold; i++) {
      state = recordProviderFailureState(state, "synthetic", `f${i + 1}`, now + i * 1000);
    }
    const checkAt = now + threshold * 1000;
    if (state.state !== "OPEN" || providerCanAttempt(state, checkAt)) return false;
    state = recordProviderSuccessState(state, "synthetic", checkAt + 1000);
    return state.state === "CLOSED" && providerCanAttempt(state, checkAt + 1000);
  }));

  tests.push(test("source_reputation_penalizes_false_positives", () => {
    const body = { source:"example-source", category:"Amazon", dealType:"deal" };
    const rep = computeSourceReputation([
      { dimension:"source", stats:{ total:20, confirmed:3, rejected:12, falsePositive:10, published:1, lastUpdatedAt:new Date(now).toISOString() } },
      { dimension:"category", stats:{ total:10, confirmed:2, rejected:6, falsePositive:5, published:1, lastUpdatedAt:new Date(now).toISOString() } },
      { dimension:"dealType", stats:{ total:10, confirmed:1, rejected:7, falsePositive:6, published:0, lastUpdatedAt:new Date(now).toISOString() } }
    ], body, now);
    return rep.score < 55 && rep.status === "DEGRADED";
  }));

  tests.push(test("prediction_layer_strong_verified_offer", () => {
    const prediction = predictOfferOutcome(
      { dealScore:95, reliabilityScore:92, conversionProbabilityScore:70, historicalLow:true },
      {
        verification:{ state:"VERIFIED" },
        sourceReputation:{ score:85 },
        opportunity:{ score:90 },
        freshness:{ ageMinutes:1 },
        outcomeProfile:{ confidence:"high" }
      },
      now
    );
    return prediction.qualityScore >= 80 && prediction.confidence === "high";
  }));

  tests.push(test("stock_price_persistence_flags_ephemeral", () => {
    const persistence = evaluateStockPricePersistence(
      { dealType:"price_error", lowStock:true, promotionTimeLimited:true },
      { verification:{ state:"VERIFIED" }, freshness:{ ageMinutes:1, maxAgeMinutes:10 } },
      now
    );
    return persistence.class === "EPHEMERAL" && persistence.urgencyScore >= 60;
  }));

  tests.push(test("revenue_attribution_low_evidence", () => {
    const profile = revenueAttributionProfile({}, {
      outcomeProfile:{ samples:{ impressions:10, clicks:1, conversions:0, revenueEUR:0 }, clickRate:0.05, conversionRate:0.02 },
      revenue:{ expectedRevenuePer1000ImpressionsEUR:2.5 }
    });
    return profile.evidence === "low";
  }));

  tests.push(test("publishing_optimizer_defers_quiet_nonurgent", () => {
    const quietNow = Date.UTC(2026, 9, 2, 2, 0, 0);
    const timing = optimizePublishingTime({}, {
      persistence:{ urgencyScore:0 },
      prediction:{ qualityScore:50 },
      opportunity:{ score:50 },
      outcomeProfile:{ confidence:"low" }
    }, quietNow);
    return timing.publishNow === false && timing.deferMinutes > 0;
  }));

  tests.push(test("adaptive_control_blocks_safe_mode", () => {
    const control = adaptiveControl33_10({
      mode:{ mode:"SAFE_MODE" },
      policy:{ blocking:[] },
      egress:{ passed:true },
      verification:{ state:"VERIFIED" },
      commercial:true,
      prediction:{ recommendation:"STRONG", confidence:"high" },
      persistence:{ urgencyScore:80, persistenceScore:60, class:"EPHEMERAL" },
      timing:{ publishNow:true, reason:"urgency_override" },
      revenueAttribution:{ evidence:"high" }
    });
    return control.action === "BLOCK";
  }));

  tests.push(test("decision_registry_classifies_publish_and_block", () => {
    return classifyDecisionEvent("published", {}) === "PUBLISHED" &&
      classifyDecisionEvent("agentos_33_10_adaptive_block", { adaptiveControl:{ action:"BLOCK" } }) === "BLOCK";
  }));

  tests.push(test("deal_performance_score_rewards_real_outcomes", () => {
    const strong = dealPerformanceScore({
      impressions:1000, clicks:80, conversions:12, engagements:50, revenueEUR:5
    });
    const weak = dealPerformanceScore({
      impressions:1000, clicks:5, conversions:0, engagements:2, revenueEUR:0
    });
    return strong.score > weak.score && strong.evidence === "medium";
  }));

  tests.push(test("champion_challenger_is_shadow_only", () => {
    const assignment = assignStrategyArm("TEST-ASIN-1", { challengerPercent:10 });
    const verdict = championChallengerVerdict({
      CHAMPION:{ impressions:100, revenueEUR:1 },
      CHALLENGER:{ impressions:20, revenueEUR:1 }
    });
    return assignment.executionMode === "SHADOW_ONLY" &&
      verdict.executionMode === "SHADOW_ONLY" &&
      verdict.verdict === "INSUFFICIENT_EVIDENCE";
  }));

  tests.push(test("continuous_edge_validation_requires_evidence", () => {
    const result = continuousEdgeValidation(
      { revenueRPM:3, predictionScore:80, opportunityScore:85 },
      { impressions:20, revenueEUR:0.05 }
    );
    return result.evidence === "insufficient" &&
      result.verdict === "INSUFFICIENT_EVIDENCE";
  }));

  tests.push(test("profit_learning_stays_shadow_without_evidence", () => {
    const result = profitLearningDecision(
      { samples:{ impressions:50, conversions:1 }, clickRate:0.04, conversionRate:0.05 },
      { calibratedRPM:4, ctr:0.04, cvr:0.05 }
    );
    return result.executionMode === "SHADOW_ONLY" &&
      result.recommendation === "INSUFFICIENT_EVIDENCE";
  }));

  tests.push(test("autonomy_promotion_requires_strong_evidence", () => {
    const blocked = autonomyPromotionGate({
      edgeValidation:{ evidence:"medium", verdict:"EDGE_PLAUSIBLE" },
      championChallenger:{ verdict:"INSUFFICIENT_EVIDENCE" },
      profitLearning:{ recommendation:"INSUFFICIENT_EVIDENCE" }
    });
    return blocked.eligible === false &&
      blocked.automaticPromotion === false &&
      blocked.action === "KEEP_CURRENT_AUTONOMY";
  }));

  const failed = tests.filter(t => !t.passed);
  return {
    version:"1.0",
    agentOsProfile:"33.10",
    passed:failed.length === 0,
    total:tests.length,
    passedCount:tests.length - failed.length,
    failedCount:failed.length,
    failed:failed.map(x => ({ name:x.name, detail:x.detail })),
    tests
  };
}
