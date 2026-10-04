import { normalizeServiceTrackingEvent, serviceFunnelSnapshot } from "./service-tracking.js";

export function runServiceTrackingSelfTest() {
  const events = [
    { eventType:"IMPRESSION", opportunityId:"o1", channel:"telegram" },
    { eventType:"CLICK", opportunityId:"o1", clickId:"c1", channel:"telegram" },
    { eventType:"LEAD", opportunityId:"o1", clickId:"c1", leadId:"l1" },
    { eventType:"ACTIVATION", opportunityId:"o1", leadId:"l1", activationId:"a1" },
    { eventType:"COMMISSION", opportunityId:"o1", activationId:"a1", revenueEUR:40, verifiedBySource:true, source:"partner_report" },
    { eventType:"COMMISSION", opportunityId:"o2", activationId:"a2", revenueEUR:99, verifiedBySource:false, source:"estimated" }
  ];

  const snapshot = serviceFunnelSnapshot(events);
  const invalid = normalizeServiceTrackingEvent({ eventType:"SALE_GUESS" });

  return {
    ok:
      snapshot.counts.impressions === 1 &&
      snapshot.counts.clicks === 1 &&
      snapshot.counts.leads === 1 &&
      snapshot.counts.activations === 1 &&
      snapshot.counts.commissions === 1 &&
      snapshot.verifiedRevenueEUR === 40 &&
      invalid.valid === false,
    testedAt:new Date().toISOString(),
    snapshot,
    invalid
  };
}
