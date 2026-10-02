function clamp(v, min = 0, max = 100) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function freshnessScore(body = {}, verification = {}, now = Date.now()) {
  if (verification?.state === "VERIFIED") {
    const age = Number(verification.ageMinutes || 0);
    return clamp(100 - age * 3);
  }
  const ts = Date.parse(body.lastVerifiedAt || body.verifiedAt || "");
  if (!Number.isFinite(ts)) return 25;
  return clamp(100 - ((now - ts) / 60000) * 2);
}

export function opportunityScoreV2(body = {}, ctx = {}, now = Date.now()) {
  const deal = clamp(body.dealScore ?? 50);
  const reliability = clamp(body.reliabilityScore ?? 50);
  const creatorQuality = clamp(ctx.creatorQuality?.score ?? ctx.creatorQuality?.total ?? 60);
  const sourceReputation = clamp(ctx.sourceReputation?.score ?? 50);
  const freshness = freshnessScore(body, ctx.verification, now);
  const conversion = clamp(body.conversionProbabilityScore ?? body.intentScore ?? 50);
  const commissionPotential = clamp(body.commissionPotentialScore ?? 50);

  let complianceRisk = 0;
  if (ctx.verification?.state !== "VERIFIED") complianceRisk += 20;
  if (ctx.policy?.blocking?.length) complianceRisk += 60;
  if (ctx.trafficSource?.status === "UNVERIFIED") complianceRisk += 10;
  if (ctx.originality?.passed === false) complianceRisk += 40;
  if (ctx.repetition?.passed === false) complianceRisk += 30;
  complianceRisk = clamp(complianceRisk);

  const score = clamp(
    deal * 0.27 +
    reliability * 0.18 +
    freshness * 0.13 +
    creatorQuality * 0.12 +
    sourceReputation * 0.10 +
    conversion * 0.10 +
    commissionPotential * 0.10 -
    complianceRisk * 0.35
  );

  const basePublishThreshold = Number(process.env.OPPORTUNITY_V2_PUBLISH_THRESHOLD || 78);
  const baseVerifyThreshold = Number(process.env.OPPORTUNITY_V2_VERIFY_THRESHOLD || 58);
  const evidenceConfidence = String(ctx.revenue?.confidence || ctx.outcomeProfile?.confidence || "low").toLowerCase();
  const confidenceAdjustment = evidenceConfidence === "high" ? 0 : evidenceConfidence === "medium" ? 2 : 4;
  const publishThreshold = clamp(basePublishThreshold + confidenceAdjustment, 0, 100);
  const verifyThreshold = clamp(baseVerifyThreshold + Math.ceil(confidenceAdjustment / 2), 0, 100);
  const commercialDataDisplayed = Boolean(body.price || body.oldPrice || body.effectivePrice || body.discount || body.coupon || body.stack);
  const verificationRequired = commercialDataDisplayed && ctx.verification?.state !== "VERIFIED";
  const action = ctx.policy?.blocking?.length
    ? "BLOCK"
    : verificationRequired && score >= verifyThreshold
      ? "VERIFY"
      : score >= publishThreshold
        ? "PUBLISH"
        : score >= verifyThreshold
          ? "OBSERVE"
          : "DISCARD";

  return {
    version:"2.1",
    score:Number(score.toFixed(1)),
    action,
    thresholds:{
      publish:publishThreshold,
      verify:verifyThreshold,
      basePublish:basePublishThreshold,
      baseVerify:baseVerifyThreshold,
      confidenceAdjustment
    },
    evidenceConfidence,
    commercialDataDisplayed,
    verificationRequired,
    components:{
      customerValue:deal,
      reliability,
      freshness,
      creatorQuality,
      sourceReputation,
      conversionProbability:conversion,
      commissionPotential,
      complianceRisk
    }
  };
}
