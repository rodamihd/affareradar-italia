import { routeServiceOpportunity, servicesCapabilitySnapshot } from "./affareradar-services.js";

export function runAffareRadarServicesSelfTest() {
  const software = routeServiceOpportunity({
    vertical:"SOFTWARE",
    sourceName:"Demo",
    market:"IT",
    currency:"EUR",
    availableInItaly:true,
    publisherEligibleInItaly:true,
    freeForPublisher:true,
    provider:"Demo AI",
    title:"AI Pro",
    monthlyPrice:19.90,
    reliabilityScore:90,
    commissionEUR:20,
    sourceVerified:true
  }, { opportunityId:"services-software" });

  const fiber = routeServiceOpportunity({
    vertical:"FIBER",
    provider:"Demo Fiber",
    title:"Fibra 2.5 Gbps",
    monthlyPrice:24.90,
    activationCost:0,
    speedMbps:2500,
    reliabilityScore:90,
    commissionEUR:40,
    sourceVerified:true
  }, { opportunityId:"services-fiber" });

  const mobile = routeServiceOpportunity({
    vertical:"MOBILE",
    provider:"Demo Mobile",
    title:"Mobile 5G",
    monthlyPrice:9.99,
    simCost:10,
    dataGB:200,
    reliabilityScore:88,
    commissionEUR:15,
    sourceVerified:true
  }, { opportunityId:"services-mobile" });

  const unsupported = routeServiceOpportunity({
    vertical:"UTILITY",
    title:"Luce"
  });

  const capabilities = servicesCapabilitySnapshot();

  return {
    ok:
      software.serviceVertical === "SOFTWARE_AI" &&
      fiber.serviceVertical === "FIBER" &&
      mobile.serviceVertical === "MOBILE" &&
      unsupported.state === "REJECTED_UNSUPPORTED_VERTICAL" &&
      capabilities.personalizedComparison === false &&
      capabilities.autoSwitch === false,
    testedAt:new Date().toISOString(),
    software,
    fiber,
    mobile,
    unsupported,
    capabilities
  };
}
