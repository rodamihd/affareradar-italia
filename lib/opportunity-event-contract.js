import crypto from "node:crypto";

export const OPPORTUNITY_EVENT_SCHEMA_VERSION = "1.0";

function stableId(prefix, raw = "") {
  const hash = crypto.createHash("sha256").update(String(raw)).digest("hex").slice(0, 24);
  return `${prefix}_${hash}`;
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value) {
  const s = String(value || "").trim();
  return s || null;
}

function verifiedAt(body = {}, verification = {}) {
  return text(
    body.lastVerifiedAt ||
    body.verifiedAt ||
    body.verificationTime ||
    verification.verifiedAt
  );
}

export function buildOpportunityEvent(body = {}, ctx = {}, now = Date.now()) {
  const occurredAt = new Date(now).toISOString();
  const asin = text(body.asin)?.toUpperCase() || null;
  const entitySeed = asin || body.amazonUrl || body.title || JSON.stringify(body);
  const entityId = ctx.entityId || stableId("affareradar", entitySeed);
  const lifecycle = ctx.lifecycle && typeof ctx.lifecycle === "object" ? ctx.lifecycle : {};
  const verification = ctx.verification && typeof ctx.verification === "object" ? ctx.verification : {};
  const freshness = ctx.freshness && typeof ctx.freshness === "object" ? ctx.freshness : {};
  const policy = ctx.policy && typeof ctx.policy === "object" ? ctx.policy : {};
  const opportunity = ctx.opportunity && typeof ctx.opportunity === "object" ? ctx.opportunity : {};
  const revenue = ctx.revenue && typeof ctx.revenue === "object" ? ctx.revenue : {};
  const sourceReputation = ctx.sourceReputation && typeof ctx.sourceReputation === "object"
    ? ctx.sourceReputation
    : {};

  return {
    schema:"affareradar.opportunity.v1",
    schemaVersion:OPPORTUNITY_EVENT_SCHEMA_VERSION,
    eventId:stableId("opp", `${entityId}|${occurredAt}|${body.effectivePrice || body.price || ""}`),
    eventType:"AFFARERADAR_OPPORTUNITY",
    domain:"affareradar",
    agentOsVersion:"26.0",
    occurredAt,
    entity:{
      id:entityId,
      asin,
      title:text(body.title),
      category:text(body.category),
      amazonUrl:text(body.amazonUrl)
    },
    source:{
      name:text(body.source),
      dataSource:text(body.amazonDataSource || body.priceSource),
      reputationScore:finite(sourceReputation.score)
    },
    pricing:{
      price:body.price ?? null,
      effectivePrice:body.effectivePrice ?? body.price ?? null,
      previousEffectivePrice:lifecycle.effectivePrice ?? null,
      oldPrice:body.oldPrice ?? null,
      currency:text(body.currency) || "EUR",
      verifiedAt:verifiedAt(body, verification)
    },
    promotion:{
      dealType:text(body.dealType)?.toLowerCase() || null,
      coupon:body.coupon ?? null,
      stack:body.stack ?? null,
      prime:body.prime === true
    },
    inventory:{
      stock:body.stock ?? null,
      stockPressure:finite(body.stockPressureScore ?? body.stockPressure)
    },
    scores:{
      deal:finite(body.dealScore),
      reliability:finite(body.reliabilityScore),
      priceErrorProbability:finite(body.priceErrorProbability ?? body.priceErrorProbabilityScore),
      affiliateProfit:finite(body.affiliateScore ?? body.profitScore ?? body.commissionPotentialScore),
      opportunity:finite(opportunity.score),
      expectedRevenuePer1000ImpressionsEUR:finite(revenue.expectedRevenuePer1000ImpressionsEUR)
    },
    verification:{
      state:text(verification.state) || "UNKNOWN",
      freshnessState:text(freshness.state) || "UNKNOWN",
      ageMinutes:finite(freshness.ageMinutes),
      refreshRequired:freshness.refreshRequired === true
    },
    governance:{
      policyDecision:text(policy.decision),
      blocking:Array.isArray(policy.blocking) ? policy.blocking.map(x => x?.id || x?.name || String(x)) : [],
      systemMode:text(ctx.mode?.mode),
      opportunityAction:text(opportunity.action),
      routingAction:text(ctx.routing?.action),
      autonomyLevel:text(ctx.autonomyLevel)
    },
    lifecycle:{
      status:text(lifecycle.status),
      firstSeenAt:text(lifecycle.firstSeenAt),
      lastPublishedAt:text(lifecycle.lastPublishedAt),
      publishCount:finite(lifecycle.publishCount)
    },
    metadata:{
      rewardProgram:text(body.rewardProgram || body.program),
      externalSignal:body.externalSignal === true,
      requestedBy:text(ctx.requestedBy) || "offerteradar-supervisor"
    }
  };
}

export function validateOpportunityEvent(event = {}) {
  const errors = [];
  if (event.schema !== "affareradar.opportunity.v1") errors.push("invalid_schema");
  if (event.domain !== "affareradar") errors.push("invalid_domain");
  if (event.agentOsVersion !== "26.0") errors.push("invalid_agentos_version");
  if (!event.eventId) errors.push("missing_event_id");
  if (!event.entity?.id) errors.push("missing_entity_id");
  if (!event.occurredAt || !Number.isFinite(Date.parse(event.occurredAt))) errors.push("invalid_occurred_at");

  return {
    valid:errors.length === 0,
    errors
  };
}
