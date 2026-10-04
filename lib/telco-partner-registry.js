const STATES = new Set([
  "DISCOVERED",
  "APPLICATION_REQUIRED",
  "APPROVED",
  "ACTIVE",
  "PAUSED",
  "REJECTED"
]);

export const telcoPartnerRegistry = [
  {
    id:"tim-awin-9773",
    brand:"TIM",
    network:"Awin",
    networkSourceId:"awin-it",
    market:"IT",
    verticals:["FIBER","MOBILE"],
    programId:"9773",
    state:"APPLICATION_REQUIRED",
    remunerationModel:"activation",
    commissionPublic:false,
    cookieDays:30,
    publisherApprovalRequired:true,
    sourceVerified:true,
    verifiedAt:"2026-10-04",
    evidence:"awin_merchant_profile_9773"
  },
  {
    id:"vodafone-it-awin-9418",
    brand:"Vodafone IT",
    network:"Awin",
    networkSourceId:"awin-it",
    market:"IT",
    verticals:["FIBER"],
    programId:"9418",
    state:"APPLICATION_REQUIRED",
    remunerationModel:"activation",
    commissionPublic:false,
    cookieDays:21,
    publisherApprovalRequired:true,
    sourceVerified:true,
    verifiedAt:"2026-10-04",
    evidence:"awin_merchant_profile_9418"
  },
  {
    id:"windtre-fixed-awin-27760",
    brand:"WINDTRE",
    network:"Awin",
    networkSourceId:"awin-it",
    market:"IT",
    verticals:["FIBER"],
    programId:"27760",
    state:"APPLICATION_REQUIRED",
    remunerationModel:"fixed_commission_on_activation",
    commissionPublic:false,
    cookieDays:30,
    publisherApprovalRequired:true,
    sourceVerified:true,
    verifiedAt:"2026-10-04",
    evidence:"awin_merchant_profile_27760"
  },
  {
    id:"windtre-mobile-awin-79270",
    brand:"WINDTRE Mobile",
    network:"Awin",
    networkSourceId:"awin-it",
    market:"IT",
    verticals:["MOBILE"],
    programId:"79270",
    state:"APPLICATION_REQUIRED",
    remunerationModel:"new_sim_activation",
    commissionPublic:false,
    cookieDays:30,
    publisherApprovalRequired:true,
    restrictions:["promo_4_99_not_promotable"],
    sourceVerified:true,
    verifiedAt:"2026-10-04",
    evidence:"awin_merchant_profile_79270"
  }
];

export function getTelcoPartner(id) {
  return telcoPartnerRegistry.find(x => x.id === id) || null;
}

export function telcoPartnerOperationalState(partner = {}) {
  const state = STATES.has(partner.state) ? partner.state : "DISCOVERED";
  const italy = partner.market === "IT";
  const verified = partner.sourceVerified === true;
  const active = ["APPROVED","ACTIVE"].includes(state);

  return {
    id:partner.id || null,
    italyEligible:italy,
    sourceVerified:verified,
    state,
    canIngestOffers:italy && verified && active,
    canApply:italy && verified && state === "APPLICATION_REQUIRED",
    commissionKnown:partner.commissionPublic === true
  };
}

export function telcoApplicationQueue() {
  return telcoPartnerRegistry
    .map(partner => ({ partner, state:telcoPartnerOperationalState(partner) }))
    .filter(x => x.state.canApply)
    .map(x => ({
      id:x.partner.id,
      brand:x.partner.brand,
      network:x.partner.network,
      verticals:x.partner.verticals,
      programId:x.partner.programId
    }));
}
