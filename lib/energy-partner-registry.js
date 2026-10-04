const STATES = new Set([
  "DISCOVERED",
  "APPLICATION_REQUIRED",
  "APPROVED",
  "ACTIVE",
  "PAUSED",
  "REJECTED"
]);

export const energyPartnerRegistry = [
  {
    id:"eni-plenitude-awin-9529",
    brand:"Eni Plenitude",
    network:"Awin",
    networkSourceId:"awin-it",
    market:"IT",
    commodities:["ELECTRICITY","GAS"],
    programId:"9529",
    state:"APPLICATION_REQUIRED",
    remunerationModel:"lead",
    commissionPublic:false,
    cookieDays:30,
    publisherApprovalRequired:true,
    restrictions:["SOCIAL_INSTAGRAM_FACEBOOK_PROHIBITED"],
    sourceVerified:true,
    verifiedAt:"2026-10-04",
    evidence:"awin_merchant_profile_9529"
  },
  {
    id:"sorgenia-awin-9584",
    brand:"Sorgenia",
    network:"Awin",
    networkSourceId:"awin-it",
    market:"IT",
    commodities:["ELECTRICITY","GAS"],
    programId:"9584",
    state:"APPLICATION_REQUIRED",
    remunerationModel:"lead_or_activation",
    commissionPublic:false,
    cookieDays:30,
    publisherApprovalRequired:true,
    restrictions:[],
    sourceVerified:true,
    verifiedAt:"2026-10-04",
    evidence:"awin_merchant_profile_9584"
  },
  {
    id:"octopus-energy-awin-69316",
    brand:"Octopus Energy",
    network:"Awin",
    networkSourceId:"awin-it",
    market:"IT",
    commodities:["ELECTRICITY"],
    programId:"69316",
    state:"APPLICATION_REQUIRED",
    remunerationModel:"lead_or_activation",
    commissionPublic:false,
    cookieDays:1,
    publisherApprovalRequired:true,
    restrictions:[],
    sourceVerified:true,
    verifiedAt:"2026-10-04",
    evidence:"awin_merchant_profile_69316"
  },
  {
    id:"windtre-energy-awin-128245",
    brand:"WINDTRE Luce&GAS",
    network:"Awin",
    networkSourceId:"awin-it",
    market:"IT",
    commodities:["ELECTRICITY","GAS"],
    programId:"128245",
    state:"APPLICATION_REQUIRED",
    remunerationModel:"lead_or_activation",
    commissionPublic:false,
    cookieDays:30,
    publisherApprovalRequired:true,
    restrictions:[],
    sourceVerified:true,
    verifiedAt:"2026-10-04",
    evidence:"awin_merchant_profile_128245"
  }
];

export function getEnergyPartner(id) {
  return energyPartnerRegistry.find(x => x.id === id) || null;
}

export function energyPartnerOperationalState(partner = {}) {
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
    commissionKnown:partner.commissionPublic === true,
    socialRestricted:Array.isArray(partner.restrictions) &&
      partner.restrictions.some(x => String(x).includes("SOCIAL"))
  };
}

export function energyApplicationQueue() {
  return energyPartnerRegistry
    .map(partner => ({ partner, state:energyPartnerOperationalState(partner) }))
    .filter(x => x.state.canApply)
    .map(x => ({
      id:x.partner.id,
      brand:x.partner.brand,
      network:x.partner.network,
      commodities:x.partner.commodities,
      programId:x.partner.programId,
      restrictions:x.partner.restrictions
    }));
}
