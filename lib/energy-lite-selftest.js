import { normalizeEnergyLiteOffer, energyOpportunitySummary } from "./energy-lite.js";

export function runEnergyLiteSelfTest() {
  const electricity = normalizeEnergyLiteOffer({
    commodity:"electricity",
    provider:"Utility Demo",
    title:"Luce Fix 12",
    energyComponentPrice:0.14,
    monthlyFixedFee:10,
    durationMonths:12,
    priceLockMonths:12,
    bonus:"EUR 60 bonus",
    reliabilityScore:90,
    commissionEUR:35,
    sourceVerified:true
  }, { opportunityId:"energy-electricity" });

  const gas = normalizeEnergyLiteOffer({
    commodity:"gas",
    provider:"Gas Demo",
    title:"Gas Flex",
    energyComponentPrice:0.55,
    monthlyFixedFee:9,
    indexationType:"indicizzato",
    durationMonths:12,
    reliabilityScore:88,
    commissionEUR:30,
    sourceVerified:true
  }, { opportunityId:"energy-gas" });

  const summary = energyOpportunitySummary(electricity);

  return {
    ok:
      electricity.opportunity.opportunityType === "UTILITY" &&
      electricity.claimPolicy.personalizedComparison === false &&
      electricity.claimPolicy.bestForUserClaimAllowed === false &&
      electricity.claimPolicy.consentRequiredForSwitch === true &&
      gas.commodity === "GAS" &&
      summary?.message?.includes("non e una raccomandazione personalizzata"),
    testedAt:new Date().toISOString(),
    electricity,
    gas,
    summary
  };
}
