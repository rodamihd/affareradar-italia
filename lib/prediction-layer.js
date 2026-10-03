function clamp(v, min = 0, max = 100) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function confidenceWeight(value = "low") {
  const v = String(value || "low").toLowerCase();
  return v === "high" ? 1 : v === "medium" ? 0.7 : 0.4;
}

export function predictOfferOutcome(body = {}, ctx = {}, now = Date.now()) {
  const deal = clamp(body.dealScore ?? 50);
  const reliability = clamp(body.reliabilityScore ?? 50);
  const source = clamp(ctx.sourceReputation?.score ?? 50);
  const opportunity = clamp(ctx.opportunity?.score ?? 50);
  const verified = ctx.verification?.state === "VERIFIED" ? 100 : 25;
  const age = Number(ctx.freshness?.ageMinutes);
  const freshness = Number.isFinite(age) ? clamp(100 - age * 4) : 30;
  const outcomeConfidence = confidenceWeight(ctx.outcomeProfile?.confidence);
  const historicalBoost = body.historicalLow === true ? 8 : 0;
  const rewardPenalty = body.rewardProgram ? 3 : 0;

  const qualityScore = clamp(
    deal * 0.23 +
    reliability * 0.18 +
    source * 0.12 +
    opportunity * 0.20 +
    verified * 0.12 +
    freshness * 0.10 +
    outcomeConfidence * 100 * 0.05 +
    historicalBoost -
    rewardPenalty
  );

  const conversionProbability = clamp(
    Number(body.conversionProbabilityScore ?? ctx.outcomeProfile?.conversionProbabilityScore ?? 20)
  );
  const survivalProbability = clamp(
    reliability * 0.30 +
    source * 0.20 +
    freshness * 0.20 +
    verified * 0.20 +
    (body.historicalLow ? 70 : 50) * 0.10
  );

  const confidence = outcomeConfidence >= 1 && source >= 70 ? "high"
    : outcomeConfidence >= 0.7 || source >= 60 ? "medium" : "low";

  return {
    version:"1.0",
    generatedAt:new Date(now).toISOString(),
    qualityScore:Number(qualityScore.toFixed(1)),
    conversionProbabilityScore:Number(conversionProbability.toFixed(1)),
    survivalProbabilityScore:Number(survivalProbability.toFixed(1)),
    confidence,
    recommendation:
      qualityScore >= 80 && survivalProbability >= 60 ? "STRONG" :
      qualityScore >= 65 ? "PROMISING" :
      qualityScore >= 50 ? "UNCERTAIN" : "WEAK"
  };
}
