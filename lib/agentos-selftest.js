import { offerDagTemplate, readyDagNodes, scheduleNodeRetry } from "./agentos-dag.js";
import { AGENTOS_PROFILE_VERSION, resolveSignalIntent, freshnessSla, egressGuard } from "./agentos-33_10-profile.js";
import {
  providerCanAttempt,
  providerHealthDefaults,
  recordProviderFailureState,
  recordProviderSuccessState
} from "./provider-health.js";
import { computeSourceReputation } from "./source-reputation.js";

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
