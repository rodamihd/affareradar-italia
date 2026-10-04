function clamp(v, min = 0, max = 100) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pctDiscount(opportunity = {}) {
  const c = opportunity.commercial || {};
  if (num(c.discountPercent) != null) return clamp(c.discountPercent, 0, 100);
  if (num(c.oldPrice) != null && num(c.price) != null && c.oldPrice > c.price) {
    return clamp(((c.oldPrice - c.price) / c.oldPrice) * 100, 0, 100);
  }
  return 0;
}

function reliability(opportunity = {}) {
  return clamp(opportunity.quality?.reliabilityScore ?? 70);
}

function recurringPenalty(opportunity = {}) {
  const c = opportunity.constraints || {};
  let p = 0;
  const binding = num(c.bindingMonths);
  const cancellation = num(c.cancellationCost);
  const modem = num(c.modemCost);
  if (binding != null) p += Math.min(15, binding * 0.5);
  if (cancellation != null && cancellation > 0) p += Math.min(12, cancellation / 10);
  if (modem != null && modem > 0) p += Math.min(10, modem / 10);
  if (c.mandatoryExtras) p += 8;
  return clamp(p, 0, 35);
}

function costTransparency(opportunity = {}) {
  const c = opportunity.commercial || {};
  let score = 45;
  if (c.price != null || c.monthlyPrice != null) score += 15;
  if (c.annualCost != null) score += 15;
  if (c.activationCost != null) score += 5;
  if (c.durationMonths != null) score += 5;
  if (c.validUntil) score += 5;
  if (opportunity.constraints?.notes || opportunity.constraints?.bindingMonths != null) score += 5;
  if (opportunity.provenance?.sourceVerified === true) score += 5;
  return clamp(score);
}

function economicValue(opportunity = {}) {
  const type = opportunity.opportunityType;
  const c = opportunity.commercial || {};
  const discount = pctDiscount(opportunity);

  if (type === "PRODUCT") {
    return clamp(discount * 1.4 + (opportunity.benefits?.historicalLow === true ? 25 : 0));
  }

  if (["SERVICE","SOFTWARE","UTILITY"].includes(type)) {
    let score = 45;
    if (c.monthlyPrice != null) {
      if (c.monthlyPrice <= 10) score += 25;
      else if (c.monthlyPrice <= 20) score += 20;
      else if (c.monthlyPrice <= 30) score += 15;
      else if (c.monthlyPrice <= 50) score += 8;
    }
    if (discount > 0) score += Math.min(25, discount);
    if ((c.activationCost || 0) === 0) score += 5;
    return clamp(score);
  }

  return 50;
}

function benefitValue(opportunity = {}) {
  let score = 40;
  const b = opportunity.benefits || {};
  if (b.bonus) score += 15;
  if (b.included) score += 15;
  if (b.prime === true) score += 5;
  if (b.historicalLow === true) score += 15;
  return clamp(score);
}

export function convenienceScore(opportunity = {}) {
  const economic = economicValue(opportunity);
  const transparent = costTransparency(opportunity);
  const benefit = benefitValue(opportunity);
  const reliable = reliability(opportunity);
  const penalty = recurringPenalty(opportunity);

  const score = clamp(
    economic * 0.40 +
    transparent * 0.20 +
    benefit * 0.15 +
    reliable * 0.25 -
    penalty
  );

  return {
    score:Math.round(score),
    components:{
      economicValue:Math.round(economic),
      costTransparency:Math.round(transparent),
      benefitValue:Math.round(benefit),
      reliability:Math.round(reliable),
      constraintPenalty:Math.round(penalty)
    },
    publishable:score >= Number(process.env.CONVENIENCE_MIN_SCORE || 65),
    threshold:Number(process.env.CONVENIENCE_MIN_SCORE || 65)
  };
}

export function revenueScore(opportunity = {}) {
  const m = opportunity.monetization || {};
  const commissionEUR = num(m.commissionEUR) || 0;
  const commissionPercent = num(m.commissionPercent) || 0;
  const recurringBonus = m.recurringCommission === true ? 15 : 0;

  const score = clamp(
    Math.min(60, commissionEUR * 1.5) +
    Math.min(30, commissionPercent * 3) +
    recurringBonus
  );

  return {
    score:Math.round(score),
    components:{
      commissionEUR,
      commissionPercent,
      recurringCommission:m.recurringCommission === true
    }
  };
}

export function evaluateOpportunityEconomics(opportunity = {}) {
  const convenience = convenienceScore(opportunity);
  const revenue = revenueScore(opportunity);

  return {
    schema:"affareradar.economics.v1",
    opportunityId:opportunity.opportunityId || null,
    opportunityType:opportunity.opportunityType || null,
    convenience,
    revenue,
    decision:convenience.publishable ? "ELIGIBLE" : "HOLD",
    principle:"USER_VALUE_FIRST"
  };
}

export function rankComparableOpportunities(items = [], options = {}) {
  const tolerance = Number(options.convenienceTolerance ?? process.env.CONVENIENCE_EQUIVALENCE_TOLERANCE ?? 3);
  const evaluated = items.map(opportunity => ({
    opportunity,
    economics:evaluateOpportunityEconomics(opportunity)
  })).filter(x => x.economics.convenience.publishable);

  evaluated.sort((a, b) => {
    const ca = a.economics.convenience.score;
    const cb = b.economics.convenience.score;
    const delta = cb - ca;

    if (Math.abs(delta) > tolerance) return delta;
    return b.economics.revenue.score - a.economics.revenue.score;
  });

  return {
    principle:"CONVENIENCE_FIRST_REVENUE_TIEBREAK_ONLY",
    tolerance,
    ranked:evaluated.map((x, index) => ({
      rank:index + 1,
      opportunityId:x.opportunity.opportunityId || null,
      convenienceScore:x.economics.convenience.score,
      revenueScore:x.economics.revenue.score,
      opportunity:x.opportunity
    }))
  };
}
