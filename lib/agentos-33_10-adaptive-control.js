export function adaptiveControl33_10(ctx = {}) {
  const blockers = [];
  if (ctx.mode?.mode === "SAFE_MODE") blockers.push("safe_mode");
  if (ctx.policy?.blocking?.length) blockers.push("policy_block");
  if (ctx.egress?.passed === false) blockers.push("egress_block");
  if (ctx.verification?.state !== "VERIFIED" && ctx.commercial === true) blockers.push("verification_required");

  const prediction = ctx.prediction || {};
  const persistence = ctx.persistence || {};
  const timing = ctx.timing || {};
  const revenueAttribution = ctx.revenueAttribution || {};

  let action = "GO";
  let reason = "all_guards_passed";

  if (blockers.length) {
    action = "BLOCK";
    reason = blockers[0];
  } else if (prediction.recommendation === "WEAK" && Number(persistence.urgencyScore || 0) < 50) {
    action = "HOLD";
    reason = "weak_prediction";
  } else if (timing.publishNow === false) {
    action = "DEFER";
    reason = timing.reason || "timing_optimizer";
  } else if (Number(persistence.persistenceScore || 0) < 35 && Number(persistence.urgencyScore || 0) < 60) {
    action = "REVERIFY";
    reason = "low_persistence_confidence";
  }

  const autonomy =
    blockers.length ? "OBSERVE" :
    prediction.confidence === "low" || revenueAttribution.evidence === "low" ? "SUPERVISED" :
    "AUTONOMOUS";

  return {
    version:"33.10",
    action,
    reason,
    autonomy,
    blockers,
    controls:{
      prediction:prediction.recommendation || null,
      predictionConfidence:prediction.confidence || null,
      persistenceClass:persistence.class || null,
      timing:timing.reason || null,
      revenueEvidence:revenueAttribution.evidence || null
    }
  };
}
