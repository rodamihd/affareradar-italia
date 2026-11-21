import crypto from "node:crypto";

export const SHADOW_CONTRACT = "agentos.shadow.v1";
export const EVIDENCE_HASH_VERSION = "2";
export const VERIFIED_EVIDENCE_CONTRACT = "agentos.verified_evidence.v1";
export const EVIDENCE_HASH_ALGORITHM = "sha256";
export const EVIDENCE_CANONICALIZATION = "agentos-json-c14n-v1";

const RANK = {
  PUBLISH:0, GO:0, ALLOW:0,
  HOLD:1, DEFER:1, REVERIFY:1, VERIFY:1, REVIEW:1,
  BLOCK:2, BLOCKED:2, REJECT:2, REJECTED:2
};

function canonicalize(value){
  const seen = new WeakSet();

  function encode(current, path){
    if (current === null) return "null";

    switch (typeof current){
      case "string":
        return JSON.stringify(current);
      case "number":
        if (!Number.isFinite(current)){
          throw new TypeError(`Evidence contains non-finite number at ${path}`);
        }
        return JSON.stringify(current);
      case "boolean":
        return current ? "true" : "false";
      case "undefined":
      case "function":
      case "symbol":
      case "bigint":
        throw new TypeError(`Evidence contains unsupported ${typeof current} at ${path}`);
      case "object":
        break;
      default:
        throw new TypeError(`Evidence contains unsupported value at ${path}`);
    }

    if (seen.has(current)){
      throw new TypeError(`Evidence contains circular reference at ${path}`);
    }
    seen.add(current);

    try {
      if (Array.isArray(current)){
        return `[${current.map((item, index) => encode(item, `${path}[${index}]`)).join(",")}]`;
      }

      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null){
        throw new TypeError(`Evidence contains non-plain object at ${path}`);
      }

      const pairs = Object.keys(current)
        .sort()
        .map(key => `${JSON.stringify(key)}:${encode(current[key], `${path}.${key}`)}`);
      return `{${pairs.join(",")}}`;
    } finally {
      seen.delete(current);
    }
  }

  return encode(value, "$");
}

function hash(value){
  return crypto.createHash("sha256").update(canonicalize(value)).digest("hex");
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
  outcomeId = null,
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

  const decisionId = String(eventId || hash(fullEvidence).slice(0,20));

  return {
    contract:SHADOW_CONTRACT,
    evidence_contract:VERIFIED_EVIDENCE_CONTRACT,
    schema_version:"1",
    mode:"shadow",
    enforcement:false,
    vertical:"affareradar",
    decision_id:decisionId,
    outcome_id:outcomeId === null ? null : String(outcomeId),
    source:"affareradar-agentos-33.10-shadow",
    event_id:decisionId,
    baseline_decision:baseline,
    backport_decision:backport,
    diverged:(RANK[baseline] ?? 1) !== (RANK[backport] ?? 1),
    would_block:backport === "BLOCK" && baseline !== "BLOCK",
    risk_relaxation:false,
    reasons,
    evidence:fullEvidence,
    evidence_hash_version:EVIDENCE_HASH_VERSION,
    evidence_hash_algorithm:EVIDENCE_HASH_ALGORITHM,
    evidence_canonicalization:EVIDENCE_CANONICALIZATION,
    evidence_hash:hash(fullEvidence)
  };
}
