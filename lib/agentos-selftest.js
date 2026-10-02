import { offerDagTemplate, readyDagNodes, scheduleNodeRetry } from "./agentos-dag.js";
import { resolveSignalIntent, freshnessSla, egressGuard } from "./agentos-26-profile.js";
import { buildOpportunityEvent } from "./opportunity-event-contract.js";
import { superviseOpportunity } from "./offerteradar-supervisor.js";
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

  tests.push(test("supervisor_rechecks_stale_price", () => {
    const body = {
      asin:"B000TEST26",
      title:"Test Deal",
      amazonUrl:"https://www.amazon.it/dp/B000TEST26",
      price:"49.99",
      effectivePrice:"49.99",
      dealScore:90,
      reliabilityScore:95,
      dealType:"deal",
      lastVerifiedAt:new Date(now - 6 * 60000).toISOString()
    };
    const verification = { state:"VERIFIED", verifiedAt:body.lastVerifiedAt };
    const freshness = freshnessSla(body, verification, now);
    const event = buildOpportunityEvent(body, {
      verification,
      freshness,
      policy:{ decision:"ALLOW", blocking:[] },
      opportunity:{ action:"PUBLISH", score:90 },
      lifecycle:{}
    }, now);
    const d = superviseOpportunity(event, {}, now);
    return d.status === "RECHECK" && d.reason === "price_data_older_than_5_minutes";
  }));

  tests.push(test("supervisor_price_error_below_92_goes_human", () => {
    const body = {
      asin:"B000ERR260",
      title:"Price Error Test",
      amazonUrl:"https://www.amazon.it/dp/B000ERR260",
      price:"19.99",
      effectivePrice:"19.99",
      dealScore:95,
      reliabilityScore:91,
      dealType:"price_error",
      lastVerifiedAt:new Date(now - 2 * 60000).toISOString()
    };
    const verification = { state:"VERIFIED", verifiedAt:body.lastVerifiedAt };
    const freshness = freshnessSla(body, verification, now);
    const event = buildOpportunityEvent(body, {
      verification,
      freshness,
      policy:{ decision:"ALLOW", blocking:[] },
      opportunity:{ action:"PUBLISH", score:94 },
      lifecycle:{}
    }, now);
    const d = superviseOpportunity(event, {}, now);
    return d.status === "HUMAN_REVIEW" && d.reason === "price_error_reliability_below_92";
  }));

  tests.push(test("supervisor_rejects_cooldown_without_10pct_drop", () => {
    const body = {
      asin:"B000COOL26",
      title:"Cooldown Test",
      amazonUrl:"https://www.amazon.it/dp/B000COOL26",
      price:"95",
      effectivePrice:"95",
      dealScore:92,
      reliabilityScore:95,
      dealType:"deal",
      lastVerifiedAt:new Date(now - 1 * 60000).toISOString()
    };
    const verification = { state:"VERIFIED", verifiedAt:body.lastVerifiedAt };
    const freshness = freshnessSla(body, verification, now);
    const event = buildOpportunityEvent(body, {
      verification,
      freshness,
      policy:{ decision:"ALLOW", blocking:[] },
      opportunity:{ action:"PUBLISH", score:90 },
      lifecycle:{
        effectivePrice:"100",
        lastPublishedAt:new Date(now - 2 * 3600000).toISOString()
      }
    }, now);
    const d = superviseOpportunity(event, {}, now);
    return d.status === "REJECT" && d.reason === "asin_cooldown_12h";
  }));

  tests.push(test("supervisor_approves_strong_verified_deal", () => {
    const body = {
      asin:"B000OK2600",
      title:"Approved Test",
      amazonUrl:"https://www.amazon.it/dp/B000OK2600",
      price:"39.99",
      effectivePrice:"39.99",
      dealScore:93,
      reliabilityScore:96,
      dealType:"deal",
      lastVerifiedAt:new Date(now - 1 * 60000).toISOString()
    };
    const verification = { state:"VERIFIED", verifiedAt:body.lastVerifiedAt };
    const freshness = freshnessSla(body, verification, now);
    const event = buildOpportunityEvent(body, {
      verification,
      freshness,
      policy:{ decision:"ALLOW", blocking:[] },
      opportunity:{ action:"PUBLISH", score:91 },
      lifecycle:{}
    }, now);
    const d = superviseOpportunity(event, {}, now);
    return d.status === "APPROVED_AUTO_PUBLISH";
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
    agentOsProfile:"26.0",
    passed:failed.length === 0,
    total:tests.length,
    passedCount:tests.length - failed.length,
    failedCount:failed.length,
    failed:failed.map(x => ({ name:x.name, detail:x.detail })),
    tests
  };
}
