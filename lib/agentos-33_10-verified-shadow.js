import crypto from "node:crypto";

export const SHADOW_CONTRACT = "agentos.shadow.v1";

const RANK = {
  PUBLISH:0, GO:0, ALLOW:0,
  HOLD:1, DEFER:1, REVERIFY:1, VERIFY:1, REVIEW:1,
  BLOCK:2, BLOCKED:2, REJECT:2, REJECTED:2
};

function hash(value){
  return crypto.createHash("sha256").update(JSON.stringify(value, Object.keys(value || {}).sort())).digest("hex");
}

function normalize(value){
  const v = String(value || "REVIEW").toUpperCase();
  if (["PUBLISHED","PUBLISH"].includes(v)) return "PUBLISH";
  if (["BLOCKED","BLOCK","REJECTED","REJECT"].includes(v)) return "BLOCK";
  if (["HOLD","DEFER","REVERIFY","VERIFY","REVIEW","QUEUED"].includes(v)) return "REVIEW";
  return RANK[v] === 0 ? "PUBLISH" : "REVIEW";
}

export function evaluateVerifiedBackportShadow({
  eventId,
  productionDecision,
  verification,
  policy,
  egress,
  runtimeIntegrity,
  workloadIdentity,
  evidence = {}
} = {}){
  const baseline = normalize(productionDecision);
  let backport = baseline;
  const reasons = [];

  if (baseline === "PUBLISH"){
    if (runtimeIntegrity?.status === "TAMPERED"){
      backport = "BLOCK";
      reasons.push("runtime_integrity_tampered");
    } else if (policy?.blocking?.length || egress?.passed === false){
      backport = "BLOCK";
      reasons.push(policy?.blocking?.length ? "policy_block" : "egress_block");
    } else if (verification?.state && verification.state !== "VERIFIED"){
      backport = "REVIEW";
      reasons.push("verification_required");
    } else if (workloadIdentity?.grantPresent !== true){
      // Shadow-only preview of the future zero-trust requirement.
      backport = "REVIEW";
      reasons.push("workload_identity_grant_required_in_future_enforcement");
    }
  }

  // Never make the backport less restrictive than production.
  if ((RANK[backport] ?? 1) < (RANK[baseline] ?? 1)){
    backport = baseline;
    reasons.push("risk_relaxation_prevented");
  }

  const fullEvidence = {
    ...evidence,
    verificationState: verification?.state || null,
    policyBlocking: policy?.blocking || [],
    egressPassed: egress?.passed ?? null,
    runtimeIntegrity: runtimeIntegrity?.status || "UNKNOWN",
    workloadGrantPresent: workloadIdentity?.grantPresent ?? false,
    source:"affareradar-agentos-33.10-shadow"
  };

  return {
    contract:SHADOW_CONTRACT,
    schema_version:"1",
    mode:"shadow",
    enforcement:false,
    vertical:"affareradar",
    event_id:String(eventId || hash(fullEvidence).slice(0,20)),
    baseline_decision:baseline,
    backport_decision:backport,
    diverged:(RANK[baseline] ?? 1) !== (RANK[backport] ?? 1),
    would_block:backport === "BLOCK" && baseline !== "BLOCK",
    risk_relaxation:false,
    reasons,
    evidence:fullEvidence,
    evidence_hash:hash(fullEvidence)
  };
}
