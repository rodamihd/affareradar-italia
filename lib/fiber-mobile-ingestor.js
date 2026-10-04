import { getTelcoPartner, telcoPartnerOperationalState } from "./telco-partner-registry.js";
import { normalizeOpportunity } from "./universal-opportunity.js";
import { evaluateOpportunityEconomics } from "./convenience-engine.js";
import { serviceCostModel } from "./service-cost-model.js";

function text(v, max = 500) {
  return String(v ?? "").trim().slice(0, max) || null;
}

function bool(v) {
  return v === true ? true : v === false ? false : null;
}

function normalizeServiceKind(input = {}) {
  const raw = String(input.serviceKind || input.category || "").toLowerCase();
  if (/mobile|sim|5g|4g|telefonia mobile/.test(raw)) return "MOBILE";
  return "FIBER";
}

export function normalizeFiberMobileOffer(input = {}, context = {}) {
  const serviceKind = normalizeServiceKind(input);
  const partner = input.partnerRegistryId ? getTelcoPartner(input.partnerRegistryId) : null;
  const partnerState = partner ? telcoPartnerOperationalState(partner) : null;
  const cost = serviceCostModel(input);

  const opportunity = normalizeOpportunity({
    opportunityType:"SERVICE",
    provider:input.provider || input.operator || input.brand,
    title:input.title || input.offerName,
    category:serviceKind === "MOBILE" ? "Mobile" : "Fibra",
    monthlyPrice:cost.effectiveMonthly12,
    annualCost:cost.total12Months,
    activationCost:cost.activationCost + cost.modemUpfrontCost + cost.simCost + cost.mandatoryUpfrontExtras,
    billingCycle:"monthly",
    durationMonths:input.durationMonths,
    validUntil:input.validUntil,
    bonus:input.bonus || input.promo,
    included:[
      input.speedMbps ? `Velocita fino a ${input.speedMbps} Mbps` : null,
      input.dataGB ? `${input.dataGB} GB` : null,
      input.minutesIncluded ? `${input.minutesIncluded} minuti` : null,
      input.modemIncluded === true ? "Modem incluso" : null
    ].filter(Boolean).join(" • "),
    bindingMonths:input.bindingMonths,
    cancellationCost:cost.exitCost,
    modemCost:cost.modemUpfrontCost + (cost.modemMonthlyCost * Math.max(12, Number(input.bindingMonths || 12))),
    mandatoryExtras:input.mandatoryExtras,
    constraints:input.termsSummary,
    reliabilityScore:input.reliabilityScore ?? 80,
    monetizationModel:input.monetizationModel || "lead_or_activation",
    commissionEUR:input.commissionEUR,
    commissionPercent:input.commissionPercent,
    recurringCommission:input.recurringCommission,
    source:input.sourceName || input.network || input.source,
    sourceVerified:input.sourceVerified === true,
    lastVerifiedAt:input.lastVerifiedAt,
    offerUrl:input.offerUrl || input.url,
    campaign:context.campaign || input.campaign,
    contentType:serviceKind === "MOBILE" ? "mobile_offer" : "fiber_offer"
  }, context);

  const economics = evaluateOpportunityEconomics(opportunity);

  return {
    schema:"affareradar.fiber-mobile.v1",
    partner,
    partnerState,
    serviceKind,
    cost,
    opportunity,
    economics,
    publicationState:
      partnerState && !partnerState.canIngestOffers ? "PARTNER_NOT_ACTIVE" :
      economics.convenience.publishable ? "SHADOW_ELIGIBLE" : "HOLD_CONVENIENCE",
    disclosures:{
      personalizedComparison:false,
      bestForUserClaimAllowed:false,
      affiliateDisclosureRequired:true
    }
  };
}

export function normalizeFiberMobileBatch(items = [], context = {}) {
  const rows = Array.isArray(items) ? items.slice(0, 200) : [];
  const normalized = rows.map((item, i) =>
    normalizeFiberMobileOffer(item || {}, { ...context, opportunityId:context.opportunityId || `service:${i}` })
  );

  return {
    schema:"affareradar.fiber-mobile-batch.v1",
    total:normalized.length,
    fiber:normalized.filter(x => x.serviceKind === "FIBER").length,
    mobile:normalized.filter(x => x.serviceKind === "MOBILE").length,
    eligible:normalized.filter(x => x.publicationState === "SHADOW_ELIGIBLE").length,
    held:normalized.filter(x => x.publicationState === "HOLD_CONVENIENCE").length,
    items:normalized
  };
}
