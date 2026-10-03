function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function revenueAttributionProfile(body = {}, ctx = {}) {
  const outcome = ctx.outcomeProfile || {};
  const revenue = ctx.revenue || {};
  const impressions = num(outcome.samples?.impressions);
  const clicks = num(outcome.samples?.clicks);
  const conversions = num(outcome.samples?.conversions);
  const observedRevenue = num(outcome.samples?.revenueEUR ?? outcome.revenueEUR);
  const expectedRPM = num(revenue.expectedRevenuePer1000ImpressionsEUR);
  const observedRPM = impressions > 0 ? observedRevenue / impressions * 1000 : 0;
  const ctr = impressions > 0 ? clicks / impressions : num(outcome.clickRate);
  const cvr = clicks > 0 ? conversions / clicks : num(outcome.conversionRate);

  const evidence =
    impressions >= 1000 && conversions >= 25 ? "high" :
    impressions >= 200 && conversions >= 5 ? "medium" : "low";
  const weight = evidence === "high" ? 0.75 : evidence === "medium" ? 0.45 : 0.20;
  const calibratedRPM = observedRPM > 0
    ? observedRPM * weight + expectedRPM * (1 - weight)
    : expectedRPM;

  return {
    version:"1.0",
    model:"bayesian_shrinkage_style_attribution",
    evidence,
    samples:{ impressions, clicks, conversions },
    observedRevenueEUR:Number(observedRevenue.toFixed(2)),
    observedRPM:Number(observedRPM.toFixed(2)),
    expectedRPM:Number(expectedRPM.toFixed(2)),
    calibratedRPM:Number(calibratedRPM.toFixed(2)),
    ctr:Number(ctr.toFixed(4)),
    cvr:Number(cvr.toFixed(4)),
    attributionConfidenceScore:evidence === "high" ? 90 : evidence === "medium" ? 65 : 35,
    commerciallyPromising:calibratedRPM >= Number(process.env.AFFARERADAR_MIN_CALIBRATED_RPM || 1.5)
  };
}
