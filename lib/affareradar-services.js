import { normalizeSoftwareAffiliateOffer } from "./software-affiliate-ingestor.js";
import { normalizeFiberMobileOffer } from "./fiber-mobile-ingestor.js";

function kind(input = {}) {
  const explicit = String(input.serviceVertical || input.vertical || input.opportunityType || "").toUpperCase();
  if (["SOFTWARE","AI","SAAS"].includes(explicit)) return "SOFTWARE_AI";
  if (["FIBER","FIBRA","BROADBAND"].includes(explicit)) return "FIBER";
  if (["MOBILE","SIM","TELEPHONY"].includes(explicit)) return "MOBILE";

  const category = String(input.category || input.serviceKind || "").toLowerCase();
  if (/software|saas|\bai\b|cloud|hosting|vpn/.test(category)) return "SOFTWARE_AI";
  if (/mobile|sim|5g|4g|telefonia mobile/.test(category)) return "MOBILE";
  if (/fibra|fiber|internet|broadband/.test(category)) return "FIBER";
  return "UNKNOWN";
}

export function routeServiceOpportunity(input = {}, context = {}) {
  const serviceVertical = kind(input);

  if (serviceVertical === "SOFTWARE_AI") {
    const result = normalizeSoftwareAffiliateOffer(input, context);
    return {
      schema:"affareradar.services.v1",
      serviceVertical,
      engine:"software-affiliate-ingestor",
      result,
      state:result.publicationState
    };
  }

  if (serviceVertical === "FIBER" || serviceVertical === "MOBILE") {
    const result = normalizeFiberMobileOffer({ ...input, serviceKind:serviceVertical.toLowerCase() }, context);
    return {
      schema:"affareradar.services.v1",
      serviceVertical,
      engine:"fiber-mobile-ingestor",
      result,
      state:result.publicationState
    };
  }

  return {
    schema:"affareradar.services.v1",
    serviceVertical:"UNKNOWN",
    engine:null,
    result:null,
    state:"REJECTED_UNSUPPORTED_VERTICAL"
  };
}

export function servicesCapabilitySnapshot() {
  return {
    schema:"affareradar.services.capabilities.v1",
    brand:"AffareRadar Services",
    enabledVerticals:["SOFTWARE_AI","FIBER","MOBILE"],
    futureVerticals:["UTILITY"],
    personalizedComparison:false,
    autoSwitch:false,
    consentRequiredForContractualAction:true,
    rankingPrinciple:"CONVENIENCE_FIRST_REVENUE_TIEBREAK_ONLY",
    distribution:"QUANTOITALIA",
    controlPlane:"AGENTOS_33_10"
  };
}
