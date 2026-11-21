import { evaluateVerifiedBackportShadow } from "./agentos-33_10-verified-shadow.js";

export function buildAffareRadarVerifiedShadowTelemetry(record, event, payload = {}, extra = {}){
  if (!record?.decisionId) return null;

  const action = String(record.action || "OTHER").toUpperCase();
  const productionDecision =
    action === "PUBLISHED" ? "PUBLISH" :
    ["BLOCK","REJECT"].includes(action) ? "BLOCK" :
    "REVIEW";

  return evaluateVerifiedBackportShadow({
    eventId:record.decisionId,
    productionDecision,
    verification:extra.verification || null,
    policy:extra.policy || null,
    egress:extra.egress || null,
    runtimeIntegrity:extra.runtimeIntegrity || null,
    workloadIdentity:extra.workloadIdentity || null,
    evidence:{
      dealId:payload.dealId || record.dealId || null,
      event:String(event || record.event || "unknown"),
      action,
      reason:record.reason || null,
      opportunityScore:record.opportunityScore ?? null,
      predictionScore:record.predictionScore ?? null,
      sourceReputation:record.sourceReputation ?? null
    }
  });
}
