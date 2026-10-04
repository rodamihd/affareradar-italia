const STATUSES = new Set(["FREE_VERIFIED","REFUNDABLE_DEPOSIT","PAID","UNKNOWN","REJECTED"]);

export const affiliateSourceRegistry = [
  {
    id:"tradedoubler-it",
    name:"Tradedoubler Italia",
    market:"IT",
    publisherEligibleInItaly:true,
    publisherCostStatus:"FREE_VERIFIED",
    notes:"Publisher signup verified as free; advertiser Grow pricing is separate and not applicable to AffareRadar as publisher.",
    verifiedAt:"2026-10-04",
    evidence:"tradedoubler_official_publisher_signup"
  },
  {
    id:"awin-it",
    name:"Awin Italia",
    market:"IT",
    publisherEligibleInItaly:true,
    publisherCostStatus:"REFUNDABLE_DEPOSIT",
    notes:"Publisher application is described as free, but Awin also documents a one-time refundable verification deposit. Do not classify as zero-cash signup.",
    verifiedAt:"2026-10-04",
    evidence:"awin_official_publisher_pricing_and_faq"
  }
];

export function getAffiliateSource(id) {
  return affiliateSourceRegistry.find(x => x.id === id) || null;
}

export function sourceOperationalState(source = {}) {
  const status = STATUSES.has(source.publisherCostStatus) ? source.publisherCostStatus : "UNKNOWN";
  const italyOk = source.market === "IT" && source.publisherEligibleInItaly === true;

  return {
    id:source.id || null,
    italyEligible:italyOk,
    publisherCostStatus:status,
    canAutoIngest:
      italyOk &&
      status === "FREE_VERIFIED",
    requiresHumanDecision:
      !italyOk ||
      ["REFUNDABLE_DEPOSIT","PAID","UNKNOWN"].includes(status)
  };
}

export function eligibleFreeAffiliateSources() {
  return affiliateSourceRegistry
    .map(source => ({ source, state:sourceOperationalState(source) }))
    .filter(x => x.state.canAutoIngest)
    .map(x => x.source);
}
