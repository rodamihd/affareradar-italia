import { normalizeOpportunity } from "./universal-opportunity.js";
import { evaluateOpportunityEconomics, rankComparableOpportunities } from "./convenience-engine.js";

function testCase(name, input) {
  const opportunity = normalizeOpportunity(input, { dealId:`economics:${name}` });
  const economics = evaluateOpportunityEconomics(opportunity);
  return { name, opportunityType:opportunity.opportunityType, economics };
}

export function runConvenienceEngineSelfTest() {
  const product = testCase("product", {
    title:"Prodotto scontato",
    category:"Amazon",
    price:70,
    oldPrice:100,
    reliabilityScore:90,
    sourceVerified:true,
    commissionEUR:3
  });

  const fiberA = normalizeOpportunity({
    opportunityType:"SERVICE",
    title:"Fibra A",
    category:"Fibra",
    monthlyPrice:22.90,
    activationCost:0,
    reliabilityScore:90,
    provider:"Provider A",
    commissionEUR:20
  }, { dealId:"fiber-a" });

  const fiberB = normalizeOpportunity({
    opportunityType:"SERVICE",
    title:"Fibra B",
    category:"Fibra",
    monthlyPrice:23.40,
    activationCost:0,
    reliabilityScore:90,
    provider:"Provider B",
    commissionEUR:50
  }, { dealId:"fiber-b" });

  const ranked = rankComparableOpportunities([fiberA, fiberB], { convenienceTolerance:3 });

  return {
    ok:
      product.economics.convenience.score >= 65 &&
      ranked.ranked.length === 2 &&
      ranked.principle === "CONVENIENCE_FIRST_REVENUE_TIEBREAK_ONLY",
    testedAt:new Date().toISOString(),
    product,
    ranked
  };
}
