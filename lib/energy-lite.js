import { getEnergyPartner, energyPartnerOperationalState } from "./energy-partner-registry.js";
import { normalizeOpportunity } from "./universal-opportunity.js";
import { evaluateOpportunityEconomics } from "./convenience-engine.js";

function text(v, max = 500) {
  return String(v ?? "").trim().slice(0, max) || null;
}

function num(v) {
  const n = Number(String(v ?? "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalizeCommodity(input = {}) {
  const raw = String(input.commodity || input.category || input.serviceKind || "").toLowerCase();
  if (/gas/.test(raw)) return "GAS";
  return "ELECTRICITY";
}

export function normalizeEnergyLiteOffer(input = {}, context = {}) {
  const commodity = normalizeCommodity(input);
  const partner = input.partnerRegistryId ? getEnergyPartner(input.partnerRegistryId) : null;
  const partnerState = partner ? energyPartnerOperationalState(partner) : null;
  const monthlyFixedFee = num(input.monthlyFixedFee);
  const annualFixedFee = num(input.annualFixedFee) ?? (monthlyFixedFee != null ? monthlyFixedFee * 12 : null);

  const opportunity = normalizeOpportunity({
    opportunityType:"UTILITY",
    provider:input.provider || input.supplier || input.brand,
    title:input.title || input.offerName,
    category:commodity === "GAS" ? "Gas" : "Energia Luce",
    price:input.energyComponentPrice ?? input.price,
    monthlyPrice:input.estimatedMonthlyCost,
    annualCost:input.estimatedAnnualCost,
    activationCost:input.activationCost ?? 0,
    billingCycle:"monthly",
    durationMonths:input.durationMonths,
    validUntil:input.validUntil,
    bonus:input.bonus,
    included:input.includedServices || input.extraServices,
    bindingMonths:input.bindingMonths,
    cancellationCost:input.cancellationCost,
    mandatoryExtras:input.mandatoryExtras,
    constraints:[
      input.indexationType ? `Indicizzazione: ${input.indexationType}` : null,
      input.priceLockMonths ? `Prezzo bloccato: ${input.priceLockMonths} mesi` : null,
      annualFixedFee != null ? `Quota fissa annua: EUR ${annualFixedFee.toFixed(2)}` : null,
      input.termsSummary
    ].filter(Boolean).join(" • "),
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
    contentType:commodity === "GAS" ? "energy_gas_offer" : "energy_electricity_offer"
  }, context);

  const economics = evaluateOpportunityEconomics(opportunity);

  const claimPolicy = {
    personalizedComparison:false,
    billUploadUsed:false,
    personalizedSavingsClaimAllowed:false,
    bestForUserClaimAllowed:false,
    allowedClaim:"OFFERTA_INTERESSANTE_SECONDO_CRITERI_OGGETTIVI",
    consentRequiredForSwitch:true
  };

  return {
    schema:"affareradar.energy-lite.v1",
    partner,
    partnerState,
    commodity,
    opportunity,
    economics,
    claimPolicy,
    publicationState:
      partnerState && !partnerState.canIngestOffers ? "PARTNER_NOT_ACTIVE" :
      economics.convenience.publishable ? "SHADOW_ELIGIBLE" : "HOLD_CONVENIENCE"
  };
}

export function energyOpportunitySummary(result = {}) {
  if (!result?.opportunity) return null;
  const o = result.opportunity;
  return {
    provider:o.provider,
    commodity:result.commodity,
    title:o.title,
    annualCost:o.commercial?.annualCost ?? null,
    monthlyPrice:o.commercial?.monthlyPrice ?? null,
    fixedFeeAnnual:o.constraints?.notes?.match(/Quota fissa annua: EUR ([0-9.]+)/)?.[1] ?? null,
    convenienceScore:result.economics?.convenience?.score ?? null,
    revenueScore:result.economics?.revenue?.score ?? null,
    message:"Offerta interessante secondo criteri oggettivi; non e una raccomandazione personalizzata."
  };
}
