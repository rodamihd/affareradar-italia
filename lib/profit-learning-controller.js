function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function profitLearningDecision(outcomeProfile = {}, revenueAttribution = {}) {
  const samples = outcomeProfile.samples || {};
  const impressions = num(samples.impressions);
  const conversions = num(samples.conversions);
  const calibratedRPM = num(revenueAttribution.calibratedRPM);
  const ctr = num(revenueAttribution.ctr, num(outcomeProfile.clickRate));
  const cvr = num(revenueAttribution.cvr, num(outcomeProfile.conversionRate));

  const evidence =
    impressions >= 2000 && conversions >= 30 ? "high" :
    impressions >= 500 && conversions >= 8 ? "medium" :
    impressions >= 100 ? "low" : "insufficient";

  const targetRPM = num(process.env.AFFARERADAR_TARGET_RPM_EUR, 3);
  const minRPM = num(process.env.AFFARERADAR_MIN_CALIBRATED_RPM, 1.5);

  let recommendation = "INSUFFICIENT_EVIDENCE";
  if (evidence === "high" || evidence === "medium") {
    if (calibratedRPM >= targetRPM) recommendation = "BOOST_CANDIDATE";
    else if (calibratedRPM < minRPM) recommendation = "DOWNRANK_CANDIDATE";
    else recommendation = "NEUTRAL";
  }

  const suggestedWeightDelta =
    recommendation === "BOOST_CANDIDATE" ? 0.08 :
    recommendation === "DOWNRANK_CANDIDATE" ? -0.08 : 0;

  return {
    version:"1.0",
    executionMode:"SHADOW_ONLY",
    evidence,
    recommendation,
    suggestedWeightDelta,
    metrics:{
      impressions,
      conversions,
      calibratedRPM:Number(calibratedRPM.toFixed(2)),
      ctr:Number(ctr.toFixed(4)),
      cvr:Number(cvr.toFixed(4))
    }
  };
}
