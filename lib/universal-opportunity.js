const TYPES = new Set(["PRODUCT","SERVICE","UTILITY","SOFTWARE"]);

function text(v, max = 500) {
  return String(v ?? "").trim().slice(0, max) || null;
}

function number(v) {
  const n = Number(String(v ?? "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function bool(v) {
  return v === true ? true : v === false ? false : null;
}

function inferType(body = {}) {
  const explicit = String(body.opportunityType || body.type || "").trim().toUpperCase();
  if (TYPES.has(explicit)) return explicit;

  const category = String(body.category || "").toLowerCase();
  const dealType = String(body.dealType || "").toLowerCase();

  if (/luce|gas|energia|utility/.test(category)) return "UTILITY";
  if (/fibra|mobile|telefon|internet|assicur/.test(category)) return "SERVICE";
  if (/software|saas|ai|cloud|hosting|vpn/.test(category)) return "SOFTWARE";
  if (dealType === "service" || dealType === "subscription") return "SERVICE";
  return "PRODUCT";
}

export function normalizeOpportunity(body = {}, context = {}) {
  const opportunityType = inferType(body);
  const monthlyPrice = number(body.monthlyPrice ?? body.recurringPrice);
  const activationCost = number(body.activationCost);
  const annualCost = number(body.annualCost);
  const oneOffPrice = number(body.effectivePrice ?? body.price);
  const recurring = monthlyPrice != null || body.billingCycle || body.recurring === true;
  const estimatedAnnualCost = annualCost != null
    ? annualCost
    : monthlyPrice != null
      ? monthlyPrice * 12 + (activationCost || 0)
      : oneOffPrice;

  return {
    schema:"affareradar.opportunity.v1",
    opportunityId:text(context.opportunityId || body.opportunityId || body.asin || context.dealId || null, 160),
    opportunityType,
    provider:text(body.provider || body.brand || body.merchant || "Amazon", 120),
    title:text(body.title || "Opportunity", 220),
    category:text(body.category || "other", 120),
    commercial:{
      recurring,
      price:oneOffPrice,
      monthlyPrice,
      annualCost:estimatedAnnualCost,
      activationCost,
      oldPrice:number(body.oldPrice),
      discountPercent:number(body.discount),
      currency:text(body.currency || "EUR", 12),
      billingCycle:text(body.billingCycle, 40),
      durationMonths:number(body.durationMonths || body.contractMonths),
      validUntil:text(body.validUntil || body.promotionValidUntil || body.rewardValidUntil, 80)
    },
    benefits:{
      bonus:text(body.bonus || body.reward || body.rewardProgram, 200),
      included:text(body.included || body.includedServices || body.features, 500),
      prime:bool(body.prime),
      historicalLow:bool(body.historicalLow)
    },
    constraints:{
      bindingMonths:number(body.bindingMonths || body.minimumTermMonths),
      cancellationCost:number(body.cancellationCost || body.exitCost),
      modemCost:number(body.modemCost),
      mandatoryExtras:text(body.mandatoryExtras, 300),
      notes:text(body.constraints || body.termsSummary, 500)
    },
    quality:{
      dealScore:number(body.dealScore),
      reliabilityScore:number(body.reliabilityScore),
      convenienceScore:number(body.convenienceScore),
      revenueScore:number(body.revenueScore)
    },
    monetization:{
      model:text(body.monetizationModel || body.commissionModel || "affiliate", 60),
      commissionEUR:number(body.commissionEUR || body.affiliateRevenueEUR),
      commissionPercent:number(body.commissionPercent),
      recurringCommission:bool(body.recurringCommission)
    },
    provenance:{
      source:text(body.source, 180),
      sourceVerified:bool(body.sourceVerified),
      lastVerifiedAt:text(body.lastVerifiedAt || body.verifiedAt, 80),
      externalUrl:text(body.amazonUrl || body.url || body.offerUrl, 1000)
    },
    tracking:{
      channel:text(context.channel || body.channel, 80),
      campaign:text(context.campaign || body.campaign, 120),
      contentType:text(context.contentType || body.contentType || body.dealType, 80)
    },
    rawCompatibility:{
      asin:text(body.asin, 20),
      dealType:text(body.dealType, 80)
    }
  };
}

export function opportunityCompatibility(body = {}) {
  const normalized = normalizeOpportunity(body);
  return {
    valid:Boolean(normalized.title && normalized.opportunityType),
    opportunityType:normalized.opportunityType,
    backwardCompatibleProductFlow:normalized.opportunityType === "PRODUCT",
    schema:normalized.schema
  };
}
