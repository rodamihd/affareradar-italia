import { energyPartnerRegistry, energyApplicationQueue, energyPartnerOperationalState } from "./energy-partner-registry.js";

export function runEnergyPartnerRegistrySelfTest() {
  const queue = energyApplicationQueue();
  const states = energyPartnerRegistry.map(energyPartnerOperationalState);
  const eni = energyPartnerRegistry.find(x => x.id === "eni-plenitude-awin-9529");
  const sorgenia = energyPartnerRegistry.find(x => x.id === "sorgenia-awin-9584");
  const octopus = energyPartnerRegistry.find(x => x.id === "octopus-energy-awin-69316");

  return {
    ok:
      energyPartnerRegistry.length >= 4 &&
      queue.length === energyPartnerRegistry.length &&
      states.every(x => x.italyEligible && x.sourceVerified && x.canApply && !x.canIngestOffers) &&
      energyPartnerOperationalState(eni).socialRestricted === true &&
      sorgenia.remunerationModel === "activation_only" &&
      octopus.cookieDays === 1,
    testedAt:new Date().toISOString(),
    partners:energyPartnerRegistry.map(x => ({
      id:x.id,
      brand:x.brand,
      commodities:x.commodities,
      state:x.state,
      remunerationModel:x.remunerationModel,
      restrictions:x.restrictions,
      verifiedAt:x.verifiedAt
    })),
    applicationQueue:queue
  };
}
