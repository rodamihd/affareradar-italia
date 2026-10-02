export function systemMode(ctx = {}) {
  const forced = String(process.env.AFFARERADAR_SYSTEM_MODE || "").trim().toUpperCase();
  if (["NORMAL","DEGRADED","SAFE_MODE"].includes(forced)) {
    return {
      mode:forced,
      forced:true,
      reasons:["forced_by_environment"],
      publishingAllowed:forced !== "SAFE_MODE"
    };
  }

  const reasons = [];
  let mode = "NORMAL";

  if (!ctx.partnerTagConfigured) {
    mode = "SAFE_MODE";
    reasons.push("amazon_partner_tag_missing");
  }

  if (ctx.policy?.blocking?.length) {
    mode = "SAFE_MODE";
    reasons.push("blocking_policy_failure");
  }

  if (ctx.trafficSource?.mode === "strict" && ctx.trafficSource?.authorized !== true) {
    mode = "SAFE_MODE";
    reasons.push("traffic_source_not_authorized");
  }

  if (!ctx.redisConfigured && mode !== "SAFE_MODE") {
    const allowDegradedPublishing =
      String(process.env.AFFARERADAR_ALLOW_DEGRADED_PUBLISHING || "").trim().toLowerCase() === "true";
    mode = allowDegradedPublishing ? "DEGRADED" : "SAFE_MODE";
    reasons.push(
      allowDegradedPublishing
        ? "redis_unavailable_degraded_publish_explicitly_allowed"
        : "redis_unavailable_fail_closed"
    );
  }

  if (ctx.verification?.state === "STALE" && mode === "NORMAL") {
    mode = "DEGRADED";
    reasons.push("amazon_verification_stale");
  }

  return {
    mode,
    forced:false,
    reasons,
    publishingAllowed:mode !== "SAFE_MODE"
  };
}
