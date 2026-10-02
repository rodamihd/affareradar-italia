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
    const price = num(body.numericPrice, parsePrice(body.effectivePrice || body.price));
    const expectedOrderValue = num(body.expectedOrderValueEUR, price);
    const commissionRate = clamp01(body.commissionRate ?? body.estimatedCommissionRate ?? 0.03);
    payoutPerConversionEUR = expectedOrderValue * commissionRate;
  }

  const expectedRevenuePerImpressionEUR =
    clickProbability * conversionProbability * payoutPerConversionEUR;
  const expectedRevenuePer1000ImpressionsEUR = expectedRevenuePerImpressionEUR * 1000;

  return {
    version:"1.0",
    model,
    clickProbability:Number(clickProbability.toFixed(4)),
    conversionProbability:Number(conversionProbability.toFixed(4)),
    payoutPerConversionEUR:Number(payoutPerConversionEUR.toFixed(2)),
    expectedRevenuePer1000ImpressionsEUR:Number(expectedRevenuePer1000ImpressionsEUR.toFixed(2)),
    commissionPotentialScore:Math.max(0, Math.min(100, Math.round(expectedRevenuePer1000ImpressionsEUR * 8))),
    assumptions:isReward
      ? ["reward_amount_from_verified_reward_context"]
      : ["commission_rate_estimated_unless_explicitly_supplied"]
  };
}
