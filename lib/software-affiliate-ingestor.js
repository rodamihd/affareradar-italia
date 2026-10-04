import { getAffiliateSource, sourceOperationalState } from "./affiliate-source-registry.js";
import { normalizeOpportunity } from "./universal-opportunity.js";
import { evaluateOpportunityEconomics } from "./convenience-engine.js";

function text(v, max = 500) {
  return String(v ?? "").trim().slice(0, max) || null;
}

function num(v) {
  const n = Number(String(v ?? "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function bool(v) {
  return v === true ? true : v === false ? false : null;
}

function sourceAllowed(source = {}) {
  const country = String(source.country || source.market || "IT").toUpperCase();
  const currency = String(source.currency || "EUR").toUpperCase();
  const availableInItaly = source.availableInItaly !== false;
  const publisherEligible = source.publisherEligibleInItaly !== false;
  return country === "IT" && currency === "EUR" && availableInItaly && publisherEligible;
}

export function normalizeSoftwareAffiliateOffer(input = {}, context = {}) {
  const registrySource = input.sourceRegistryId ? getAffiliateSource(input.sourceRegistryId) : null;
  const registryState = registrySource ? sourceOperationalState(registrySource) : null;
  const source = {
    name:text(input.sourceName || input.network || input.source, 120),
    country:text(input.country || input.market || "IT", 8),
    currency:text(input.currency || "EUR", 8),
    availableInItaly:bool(input.availableInItaly) ?? true,
    publisherEligibleInItaly:bool(input.publisherEligibleInItaly) ?? true,
    freeForPublisher:registryState ? registryState.publisherCostStatus === "FREE_VERIFIED" : bool(input.freeForPublisher)
  };

  const acceptedSource = sourceAllowed(source) && (!registryState || registryState.canAutoIngest);

  const opportunity = normalizeOpportunity({
    opportunityType:"SOFTWARE",
    provider:input.provider || input.merchant || input.brand,
    title:input.title || input.productName || input.offerName,
    category:input.category || "Software / AI",
    monthlyPrice:input.monthlyPrice ?? input.recurringPrice,
    annualCost:input.annualCost,
    activationCost:input.activationCost ?? 0,
    billingCycle:input.billingCycle,
    durationMonths:input.durationMonths,
    validUntil:input.validUntil,
    bonus:input.bonus || input.trial || input.promo,
    included:input.features || input.included,
    bindingMonths:input.bindingMonths,
    cancellationCost:input.cancellationCost,
    mandatoryExtras:input.mandatoryExtras,
    constraints:input.constraints || input.termsSummary,
    reliabilityScore:input.reliabilityScore ?? 80,
    convenienceScore:input.convenienceScore,
    revenueScore:input.revenueScore,
    monetizationModel:input.monetizationModel || "affiliate",
    commissionEUR:input.commissionEUR,
    commissionPercent:input.commissionPercent,
    recurringCommission:input.recurringCommission,
    source:source.name,
    sourceVerified:input.sourceVerified === true,
    lastVerifiedAt:input.lastVerifiedAt,
    offerUrl:input.offerUrl || input.url,
    campaign:context.campaign || input.campaign,
    contentType:"software_affiliate"
  }, context);

  const economics = evaluateOpportunityEconomics(opportunity);

  return {
    acceptedSource,
    source,
    registrySource,
    registryState,
    opportunity,
    economics,
    publicationState:
      !acceptedSource ? "REJECTED_SOURCE" :
      !economics.convenience.publishable ? "HOLD_CONVENIENCE" :
      "SHADOW_ELIGIBLE"
  };
}

export function normalizeSoftwareAffiliateBatch(items = [], context = {}) {
  const rows = Array.isArray(items) ? items.slice(0, 200) : [];
  const normalized = rows.map((item, index) =>
    normalizeSoftwareAffiliateOffer(item || {}, { ...context, opportunityId:context.opportunityId || `software:${index}` })
  );

  return {
    schema:"affareradar.software-affiliate-batch.v1",
    total:normalized.length,
    eligible:normalized.filter(x => x.publicationState === "SHADOW_ELIGIBLE").length,
    held:normalized.filter(x => x.publicationState === "HOLD_CONVENIENCE").length,
    rejectedSource:normalized.filter(x => x.publicationState === "REJECTED_SOURCE").length,
    items:normalized
  };
}
