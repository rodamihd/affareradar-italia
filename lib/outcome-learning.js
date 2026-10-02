function clamp(v, min = 0, max = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function betaMean(successes = 0, trials = 0, alpha = 2, beta = 18) {
  const s = Math.max(0, Number(successes) || 0);
  const t = Math.max(s, Number(trials) || 0);
  return (alpha + s) / (alpha + beta + t);
}

export function learnedOutcomeProfile(stats = {}, body = {}) {
  const impressions = Number(stats.impressions || 0);
  const clicks = Number(stats.clicks || 0);
  const conversions = Number(stats.conversions || 0);
  const publishes = Number(stats.publishes || 0);
  const engagements = Number(stats.engagements || 0);

  const clickRate = betaMean(clicks, impressions, 2, 38);
  const conversionRate = betaMean(conversions, clicks, 1, 19);
  const engagementRate = betaMean(engagements, impressions, 2, 28);
  const publishSuccessRate = betaMean(Number(stats.successfulPublishes || publishes), publishes || 0, 8, 2);

  return {
    version:"1.0",
    category:String(body.category || "other").toLowerCase(),
    samples:{ impressions, clicks, conversions, publishes, engagements },
    clickRate:Number(clickRate.toFixed(4)),
    conversionRate:Number(conversionRate.toFixed(4)),
    engagementRate:Number(engagementRate.toFixed(4)),
    publishSuccessRate:Number(publishSuccessRate.toFixed(4)),
    conversionProbabilityScore:Math.round(clamp(conversionRate) * 100),
    intentScore:Math.round(clamp(clickRate * 0.55 + engagementRate * 0.45) * 100),
    confidence:impressions >= 500 ? "high" : impressions >= 100 ? "medium" : "low"
  };
}

export function mergeLearnedSignals(body = {}, profile = {}) {
  return {
    ...body,
    conversionProbabilityScore:Number.isFinite(Number(body.conversionProbabilityScore))
      ? Number(body.conversionProbabilityScore)
      : profile.conversionProbabilityScore,
    intentScore:Number.isFinite(Number(body.intentScore))
      ? Number(body.intentScore)
      : profile.intentScore,
    outcomeLearningVersion:profile.version || "1.0"
  };
}
