function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, num(value, 0)));
}

function parsePrice(value) {
  const normalized = String(value || "")
    .replace(/[^0-9,.-]/g, "")
    .replace(",", ".");
  return num(normalized, 0);
}

export function expectedRevenue(body = {}, ctx = {}) {
  const isReward = Boolean(ctx.reward?.isReward);
  const clickProbability = clamp01(
    body.clickProbability ?? ctx.outcomeProfile?.clickRate ?? 0.05
  );
  const conversionProbability = clamp01(
    body.conversionProbability ?? ctx.outcomeProfile?.conversionRate ?? 0.03
  );

  let payoutPerConversionEUR = 0;
  let model = "product_commission_estimate";

  if (isReward) {
    payoutPerConversionEUR = num(ctx.reward?.rewardAmountEUR, 0);
    model = "reward_bounty";
  } else {
    const observedConversions = num(ctx.outcomeProfile?.samples?.conversions, 0);
    const observedPayout = num(ctx.outcomeProfile?.revenuePerConversionEUR, 0);
    const price = num(body.numericPrice, parsePrice(body.effectivePrice || body.price));
    const expectedOrderValue = num(body.expectedOrderValueEUR, price);
    const commissionRate = clamp01(body.commissionRate ?? body.estimatedCommissionRate ?? 0.03);
    const estimatedPayout = expectedOrderValue * commissionRate;

    if (observedConversions > 0 && observedPayout > 0) {
      const observedWeight = Math.min(1, observedConversions / 20);
      payoutPerConversionEUR =
        observedPayout * observedWeight +
        estimatedPayout * (1 - observedWeight);
      model = observedWeight >= 1
        ? "observed_revenue_calibration"
        : "blended_revenue_calibration";
    } else {
      payoutPerConversionEUR = estimatedPayout;
    }
  }

  const expectedRevenuePerImpressionEUR =
    clickProbability * conversionProbability * payoutPerConversionEUR;
  const expectedRevenuePer1000ImpressionsEUR = expectedRevenuePerImpressionEUR * 1000;

  const observedConversions = num(ctx.outcomeProfile?.samples?.conversions, 0);
  const dataConfidence =
    ctx.outcomeProfile?.confidence === "high" && observedConversions >= 20 ? "high" :
    ctx.outcomeProfile?.confidence === "medium" || observedConversions >= 5 ? "medium" : "low";
  const uncertaintyFactor =
    dataConfidence === "high" ? 0.20 :
    dataConfidence === "medium" ? 0.40 : 0.65;

  return {
    version:"1.1",
    model,
    clickProbability:Number(clickProbability.toFixed(4)),
    conversionProbability:Number(conversionProbability.toFixed(4)),
    payoutPerConversionEUR:Number(payoutPerConversionEUR.toFixed(2)),
    expectedRevenuePer1000ImpressionsEUR:Number(expectedRevenuePer1000ImpressionsEUR.toFixed(2)),
    commissionPotentialScore:Math.max(0, Math.min(100, Math.round(expectedRevenuePer1000ImpressionsEUR * 8))),
    confidence:dataConfidence,
    observedConversions,
    uncertaintyRangeEUR:{
      low:Number((expectedRevenuePer1000ImpressionsEUR * Math.max(0, 1 - uncertaintyFactor)).toFixed(2)),
      high:Number((expectedRevenuePer1000ImpressionsEUR * (1 + uncertaintyFactor)).toFixed(2))
    },
    assumptions:isReward
      ? ["reward_amount_from_verified_reward_context"]
      : ["commission_rate_estimated_unless_explicitly_supplied"]
  };
}
