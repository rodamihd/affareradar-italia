import { normalizeSoftwareAffiliateBatch } from "./software-affiliate-ingestor.js";

export function runSoftwareAffiliateSelfTest() {
  const result = normalizeSoftwareAffiliateBatch([
    {
      sourceName:"Demo Italian Network",
      market:"IT",
      currency:"EUR",
      availableInItaly:true,
      publisherEligibleInItaly:true,
      freeForPublisher:true,
      provider:"AI Suite Demo",
      title:"AI Suite Pro",
      monthlyPrice:19.90,
      trial:"14 giorni",
      reliabilityScore:92,
      commissionEUR:25,
      recurringCommission:true,
      sourceVerified:true
    },
    {
      sourceName:"Foreign Only Network",
      market:"US",
      currency:"USD",
      availableInItaly:false,
      publisherEligibleInItaly:false,
      provider:"Foreign SaaS",
      title:"Foreign SaaS Plan",
      monthlyPrice:15,
      reliabilityScore:90,
      commissionEUR:50
    }
  ], { campaign:"software-ai-selftest" });

  return {
    ok:
      result.total === 2 &&
      result.items[0].opportunity.opportunityType === "SOFTWARE" &&
      result.items[0].publicationState !== "REJECTED_SOURCE" &&
      result.items[1].publicationState === "REJECTED_SOURCE",
    testedAt:new Date().toISOString(),
    result
  };
}
