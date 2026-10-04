import { normalizeOpportunity, opportunityCompatibility } from "./universal-opportunity.js";

function check(name, input, expectedType) {
  const value = normalizeOpportunity(input, { dealId:`selftest:${name}` });
  const compatibility = opportunityCompatibility(input);
  return {
    name,
    passed:value.opportunityType === expectedType && compatibility.valid === true,
    expectedType,
    actualType:value.opportunityType,
    schema:value.schema,
    compatibility
  };
}

export function runUniversalOpportunitySelfTest() {
  const cases = [
    check("amazon_product", {
      title:"Cuffie Bluetooth",
      category:"Amazon",
      price:"79.99",
      asin:"B000000001"
    }, "PRODUCT"),
    check("fiber_service", {
      title:"Fibra 2.5 Gbps",
      category:"Fibra Internet",
      monthlyPrice:22.90,
      activationCost:0,
      provider:"Provider Demo"
    }, "SERVICE"),
    check("software_ai", {
      title:"AI Pro Annual",
      category:"Software AI",
      monthlyPrice:20,
      provider:"SaaS Demo"
    }, "SOFTWARE"),
    check("energy_utility", {
      title:"Offerta Luce",
      category:"Energia Luce",
      monthlyPrice:50,
      provider:"Utility Demo"
    }, "UTILITY")
  ];

  return {
    ok:cases.every(x => x.passed),
    schema:"affareradar.opportunity.v1",
    testedAt:new Date().toISOString(),
    cases
  };
}
