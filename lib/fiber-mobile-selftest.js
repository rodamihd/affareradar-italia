import { serviceCostModel } from "./service-cost-model.js";
import { normalizeFiberMobileBatch } from "./fiber-mobile-ingestor.js";

export function runFiberMobileSelfTest() {
  const cost = serviceCostModel({
    monthlyPrice:24.90,
    activationCost:29.90,
    modemMonthlyCost:3,
    promoMonths:6,
    promoMonthlyPrice:19.90
  });

  const batch = normalizeFiberMobileBatch([
    {
      serviceKind:"fiber",
      provider:"Demo Fiber",
      title:"Fibra 2.5 Gbps",
      monthlyPrice:24.90,
      activationCost:29.90,
      modemIncluded:true,
      speedMbps:2500,
      reliabilityScore:90,
      commissionEUR:40,
      sourceVerified:true
    },
    {
      serviceKind:"mobile",
      provider:"Demo Mobile",
      title:"Mobile 5G",
      monthlyPrice:9.99,
      simCost:10,
      dataGB:200,
      minutesIncluded:"illimitati",
      reliabilityScore:88,
      commissionEUR:15,
      sourceVerified:true
    }
  ], { campaign:"fiber-mobile-selftest" });

  return {
    ok:
      cost.total12Months > 0 &&
      cost.total24Months > cost.total12Months &&
      batch.total === 2 &&
      batch.fiber === 1 &&
      batch.mobile === 1 &&
      batch.items.every(x => x.opportunity.opportunityType === "SERVICE"),
    testedAt:new Date().toISOString(),
    cost,
    batch
  };
}
