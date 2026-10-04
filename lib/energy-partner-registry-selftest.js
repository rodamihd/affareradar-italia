import { energyPartnerRegistry, energyApplicationQueue, energyPartnerOperationalState } from "./energy-partner-registry.js";

export function runEnergyPartnerRegistrySelfTest() {
  const queue = energyApplicationQueue();
  const states = energyPartnerRegistry.map(energyPartnerOperationalState);
  const eni = energyPartnerRegistry.find(x => x.id === "eni-plenitude-awin-9529");
  const eniState = energyPartnerOperationalState(eni);

  return {
    ok:
      energyPartnerRegistry.length >= 4 &&
      queue.length === energyPartnerRegistry.length &&
      states.every(x => x.italyEligible && x.sourceVerified && x.canApply && !x.canIngestOffers) &&
      eniState.socialRestricted === true,
    testedAt:new Date().toISOString(),
    partners:energyPartnerRegistry.map(x => ({
      id:x.id,
      brand:x.brand,
      commodities:x.commodities,
      state:x.state,
      restrictions:x.restrictions
    })),
    applicationQueue:queue
  };
}
