import assert from "node:assert/strict";
import { classifyDecisionEvent, decisionReasonDetails, decisionReasonCodes } from "./decision-outcome-registry.js";

{
  const action = classifyDecisionEvent("revalidation_failed", {});
  assert.equal(action, "REJECT");
}

{
  const details = decisionReasonDetails("revalidation_failed", {
    revalidation:{
      failures:[
        { code:"STALE_VERIFICATION", field:"verifiedAt" },
        { code:"PRICE_NOT_VERIFIED", field:"priceVerified" }
      ],
      blockingCodes:["STALE_VERIFICATION","PRICE_NOT_VERIFIED"]
    }
  });

  const codes = details.map(x => x.code);
  assert.deepEqual(codes, ["STALE_VERIFICATION","PRICE_NOT_VERIFIED"]);
  assert.equal(details[0].source, "revalidation");
}

{
  const codes = decisionReasonCodes("policy_blocked", {
    policy:{ blocking:["missing disclosure","telegram source not authorized"] }
  });
  assert.deepEqual(codes, ["MISSING_DISCLOSURE","TELEGRAM_SOURCE_NOT_AUTHORIZED"]);
}

{
  const codes = decisionReasonCodes("agentos_33_10_adaptive_block", {
    adaptiveControl:{ reason:"low confidence" }
  });
  assert.deepEqual(codes, ["LOW_CONFIDENCE"]);
}

{
  const codes = decisionReasonCodes("opportunity_not_publishable", {
    opportunity:{ action:"DISCARD" }
  });
  assert.deepEqual(codes, ["OPPORTUNITY_DISCARD"]);
}

console.log("decision-outcome-registry selftest passed");
