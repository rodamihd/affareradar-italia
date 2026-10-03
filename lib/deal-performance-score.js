function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function rate(successes, trials) {
  const s = Math.max(0, Number(successes || 0));
  const t = Math.max(0, Number(trials || 0));
  return t > 0 ? s / t : 0;
}

export function dealPerformanceScore(outcome = {}, context = {}) {
  const impressions = Math.max(0, Number(outcome.impressions || 0));
  const clicks = Math.max(0, Number(outcome.clicks || 0));
  const conversions = Math.max(0, Number(outcome.conversions || 0));
  const engagements = Math.max(0, Number(outcome.engagements || 0));
  const revenueEUR = Math.max(0, Number(outcome.revenueEUR || 0));

  const ctr = rate(clicks, impressions);
  const cvr = rate(conversions, clicks);
  const engagementRate = rate(engagements, impressions);
  const rpm = impressions > 0 ? revenueEUR / impressions * 1000 : 0;

  const ctrScore = clamp(ctr / Number(process.env.AFFARERADAR_TARGET_CTR || 0.05) * 100);
  const cvrScore = clamp(cvr / Number(process.env.AFFARERADAR_TARGET_CVR || 0.08) * 100);
  const engagementScore = clamp(engagementRate / Number(process.env.AFFARERADAR_TARGET_ENGAGEMENT_RATE || 0.03) * 100);
  const revenueScore = clamp(rpm / Number(process.env.AFFARERADAR_TARGET_RPM_EUR || 3) * 100);

  const evidence =
    impressions >= 1000 && conversions >= 20 ? "high" :
    impressions >= 250 && clicks >= 10 ? "medium" :
    impressions >= 50 ? "low" : "insufficient";

  const evidenceWeight =
    evidence === "high" ? 1 :
    evidence === "medium" ? 0.75 :
    evidence === "low" ? 0.45 : 0.20;

  const rawScore =
    ctrScore * 0.25 +
    cvrScore * 0.30 +
    engagementScore * 0.15 +
    revenueScore * 0.30;

  const prior = Number(context.priorScore || 50);
  const score = rawScore * evidenceWeight + prior * (1 - evidenceWeight);

  return {
    version:"1.0",
    score:Math.round(clamp(score)),
    evidence,
    metrics:{
      impressions,
      clicks,
      conversions,
      engagements,
      revenueEUR:Number(revenueEUR.toFixed(2)),
      ctr:Number(ctr.toFixed(4)),
      cvr:Number(cvr.toFixed(4)),
      engagementRate:Number(engagementRate.toFixed(4)),
      rpm:Number(rpm.toFixed(2))
    },
    components:{
      ctrScore:Math.round(ctrScore),
      cvrScore:Math.round(cvrScore),
      engagementScore:Math.round(engagementScore),
      revenueScore:Math.round(revenueScore)
    }
  };
}
