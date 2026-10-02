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
  const revenueEUR = Number(stats.revenueEUR || 0);

  const clickRate = betaMean(clicks, impressions, 2, 38);
  const conversionRate = betaMean(conversions, clicks, 1, 19);
  const engagementRate = betaMean(engagements, impressions, 2, 28);
  const publishSuccessRate = betaMean(Number(stats.successfulPublishes || publishes), publishes || 0, 8, 2);

  return {
    version:"1.0",
    category:String(body.category || "other").toLowerCase(),
    samples:{ impressions, clicks, conversions, publishes, engagements, revenueEUR },
    revenueEUR:Number(revenueEUR.toFixed(2)),
    revenuePerConversionEUR:conversions > 0 ? Number((revenueEUR / conversions).toFixed(4)) : 0,
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


function slug(value = "unknown") {
  return String(value || "unknown").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

export function outcomeDimensions(body = {}, now = Date.now()) {
  const category = slug(body.category || "other");
  const source = slug(body.source || body.signalSource || "unknown");
  const dealType = slug(body.dealType || body.rewardProgram || "deal");
  const hour = new Date(now).getUTCHours();
  return [
    `category:${category}`,
    `source:${source}`,
    `dealtype:${dealType}`,
    `hour:${hour}`
  ];
}

export function mergeOutcomeStats(rows = []) {
  return rows.reduce((acc, row) => {
    if (!row || typeof row !== "object") return acc;
    for (const key of ["impressions","clicks","conversions","engagements","publishes","successfulPublishes","revenueEUR"]) {
      acc[key] = Number(acc[key] || 0) + Number(row[key] || 0);
    }
    return acc;
  }, {
    impressions:0, clicks:0, conversions:0, engagements:0,
    publishes:0, successfulPublishes:0, revenueEUR:0
  });
}
