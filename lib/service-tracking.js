const EVENT_TYPES = new Set(["IMPRESSION","CLICK","LEAD","ACTIVATION","COMMISSION"]);

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

export function normalizeServiceTrackingEvent(input = {}) {
  const eventType = String(input.eventType || "").toUpperCase();
  if (!EVENT_TYPES.has(eventType)) {
    return { valid:false, reason:"UNSUPPORTED_EVENT_TYPE", eventType:eventType || null };
  }

  const verifiedRevenue = eventType === "COMMISSION"
    ? input.verifiedBySource === true && num(input.revenueEUR) != null
    : null;

  return {
    valid:true,
    schema:"affareradar.service-tracking.v1",
    eventId:text(input.eventId || input.id, 160),
    eventType,
    occurredAt:text(input.occurredAt || new Date().toISOString(), 80),
    opportunityId:text(input.opportunityId, 160),
    partnerId:text(input.partnerId, 160),
    serviceVertical:text(input.serviceVertical, 40),
    provider:text(input.provider, 120),
    channel:text(input.channel, 80),
    campaign:text(input.campaign, 120),
    clickId:text(input.clickId, 160),
    leadId:text(input.leadId, 160),
    activationId:text(input.activationId, 160),
    externalReference:text(input.externalReference, 220),
    revenueEUR:eventType === "COMMISSION" ? num(input.revenueEUR) : null,
    verifiedBySource:eventType === "COMMISSION" ? bool(input.verifiedBySource) === true : null,
    verifiedRevenue,
    source:text(input.source, 160),
    metadata:input.metadata && typeof input.metadata === "object" ? input.metadata : {}
  };
}

export function serviceFunnelSnapshot(events = []) {
  const normalized = events
    .map(normalizeServiceTrackingEvent)
    .filter(x => x.valid);

  const counts = {
    impressions:normalized.filter(x => x.eventType === "IMPRESSION").length,
    clicks:normalized.filter(x => x.eventType === "CLICK").length,
    leads:normalized.filter(x => x.eventType === "LEAD").length,
    activations:normalized.filter(x => x.eventType === "ACTIVATION").length,
    commissions:normalized.filter(x => x.eventType === "COMMISSION" && x.verifiedRevenue === true).length
  };

  const revenueEUR = normalized
    .filter(x => x.eventType === "COMMISSION" && x.verifiedRevenue === true)
    .reduce((sum, x) => sum + (x.revenueEUR || 0), 0);

  const pct = (a, b) => b > 0 ? Number(((a / b) * 100).toFixed(2)) : null;

  return {
    schema:"affareradar.service-funnel.v1",
    counts,
    rates:{
      impressionToClick:pct(counts.clicks, counts.impressions),
      clickToLead:pct(counts.leads, counts.clicks),
      leadToActivation:pct(counts.activations, counts.leads),
      activationToCommission:pct(counts.commissions, counts.activations)
    },
    verifiedRevenueEUR:Number(revenueEUR.toFixed(2)),
    principle:"COUNT_REVENUE_ONLY_WHEN_SOURCE_VERIFIED"
  };
}
