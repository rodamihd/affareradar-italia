function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, num(value)));
}

export function continuousEdgeValidation(decision = {}, outcome = {}) {
  const impressions = num(outcome.impressions);
  const revenueEUR = num(outcome.revenueEUR);
  const observedRPM = impressions > 0 ? revenueEUR / impressions * 1000 : 0;
  const predictedRPM = num(decision.revenueRPM);
  const predictedScore = num(decision.predictionScore);
  const opportunityScore = num(decision.opportunityScore);

  const rpmError = predictedRPM > 0
    ? Math.abs(observedRPM - predictedRPM) / predictedRPM
    : null;

  const evidence =
    impressions >= 1000 ? "high" :
    impressions >= 250 ? "medium" :
    impressions >= 50 ? "low" : "insufficient";

  const calibrationScore = rpmError == null
    ? 50
    : clamp(100 * (1 - Math.min(1, rpmError)));

  const edgeCaptureScore = clamp(
    calibrationScore * 0.45 +
    predictedScore * 0.30 +
    opportunityScore * 0.25
  );

  let verdict = "INSUFFICIENT_EVIDENCE";
  if (evidence === "high" || evidence === "medium") {
    if (edgeCaptureScore >= 75) verdict = "EDGE_SUPPORTED";
    else if (edgeCaptureScore >= 55) verdict = "EDGE_PLAUSIBLE";
    else verdict = "EDGE_NOT_CAPTURED";
  }

  return {
    version:"1.0",
    evidence,
    verdict,
    predictedRPM:Number(predictedRPM.toFixed(2)),
    observedRPM:Number(observedRPM.toFixed(2)),
    rpmErrorPct:rpmError == null ? null : Number((rpmError * 100).toFixed(2)),
    calibrationScore:Math.round(calibrationScore),
    edgeCaptureScore:Math.round(edgeCaptureScore),
    predictionScore:Math.round(predictedScore),
    opportunityScore:Math.round(opportunityScore),
    samples:{ impressions }
  };
}
