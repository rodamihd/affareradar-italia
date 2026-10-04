import { telcoPartnerRegistry, telcoApplicationQueue, telcoPartnerOperationalState } from "./telco-partner-registry.js";

export function runTelcoPartnerRegistrySelfTest() {
  const queue = telcoApplicationQueue();
  const states = telcoPartnerRegistry.map(telcoPartnerOperationalState);

  return {
    ok:
      telcoPartnerRegistry.length >= 4 &&
      queue.length === telcoPartnerRegistry.length &&
      states.every(x => x.italyEligible && x.sourceVerified && x.canApply && !x.canIngestOffers),
    testedAt:new Date().toISOString(),
    partners:telcoPartnerRegistry.map(x => ({
      id:x.id,
      brand:x.brand,
      verticals:x.verticals,
      state:x.state,
      commissionPublic:x.commissionPublic
    })),
    applicationQueue:queue
  };
}
