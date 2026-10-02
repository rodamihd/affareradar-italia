export const AMAZON_POLICY_REGISTRY = [
  { id:"AMZ-POL-001", name:"Direct Amazon affiliate link", severity:"BLOCK" },
  { id:"AMZ-POL-002", name:"Amazon-verified price source", severity:"BLOCK" },
  { id:"AMZ-POL-003", name:"Image provenance", severity:"WARN" },
  { id:"AMZ-POL-004", name:"Original content", severity:"BLOCK" },
  { id:"AMZ-POL-005", name:"No public price tracking", severity:"BLOCK" },
  { id:"AMZ-POL-006", name:"Authorized traffic source", severity:"BLOCK_STRICT" },
  { id:"AMZ-POL-007", name:"Promotion not expired", severity:"BLOCK" },
  { id:"AMZ-POL-008", name:"Product eligibility", severity:"BLOCK" },
  { id:"AMZ-POL-009", name:"Amazon program data not used for AI training", severity:"BLOCK" },
  { id:"AMZ-POL-010", name:"Affiliate disclosure present", severity:"WARN" }
];

export function evaluatePolicies(body = {}, ctx = {}) {
  const results = [];
  const add = (id, passed, detail = null, severity = null) => {
    const rule = AMAZON_POLICY_REGISTRY.find(x => x.id === id);
    results.push({
      id,
      name:rule?.name || id,
      severity:severity || rule?.severity || "WARN",
      passed:Boolean(passed),
      detail
    });
  };

  let directLink = false;
  try {
    const u = new URL(body.amazonUrl || "");
    directLink = u.hostname === "amazon.it" || u.hostname.endsWith(".amazon.it") || u.hostname === "amzn.eu" || u.hostname === "link.amazon";
  } catch {}

  add("AMZ-POL-001", directLink, directLink ? "direct_amazon_destination" : "invalid_or_indirect_destination");
  const commercialDataDisplayed = Boolean(body.price || body.oldPrice || body.effectivePrice || body.discount || body.coupon || body.stack);
  add("AMZ-POL-002", !commercialDataDisplayed || ctx.verification?.state === "VERIFIED" || Boolean(body.rewardProgram), commercialDataDisplayed ? (ctx.verification?.state || "UNVERIFIED") : "no_commercial_data_displayed");
  add("AMZ-POL-003", ctx.publication?.imageProvenance?.passed !== false, ctx.publication?.imageProvenance?.status || null);
  add("AMZ-POL-004", ctx.originality?.passed !== false, ctx.originality?.status || null);
  add("AMZ-POL-005", true, "public_price_tracking_disabled");
  add("AMZ-POL-006", ctx.trafficSource?.passed !== false, ctx.trafficSource?.status || null);
  add("AMZ-POL-007", ctx.promotionExpired !== true, ctx.promotionExpired ? "expired" : "active_or_not_time_limited");
  add("AMZ-POL-008", ctx.publication?.productEligibility?.passed !== false, ctx.publication?.productEligibility?.status || null);
  add("AMZ-POL-009", !(body.amazonProgramContent === true && body.aiTrainingAllowed !== false), body.dataUsagePolicy || null);
  add("AMZ-POL-010", ctx.disclosurePresent !== false, ctx.disclosurePresent === false ? "missing" : "present_by_publisher");

  const blocking = results.filter(r => !r.passed && (r.severity === "BLOCK" || (r.severity === "BLOCK_STRICT" && ctx.trafficSource?.mode === "strict")));
  const warnings = results.filter(r => !r.passed && !blocking.includes(r));

  return {
    version:process.env.AMAZON_POLICY_VERSION || "2026-04-14",
    total:results.length,
    passed:results.filter(r => r.passed).length,
    blocking,
    warnings,
    results,
    decision:blocking.length ? "BLOCK" : warnings.length ? "ALLOW_WITH_WARNINGS" : "ALLOW"
  };
}
