import crypto from "node:crypto";

export const AGENTOS_EXTERNAL_VERSION = "33.10";
export const AGENTOS_EXTERNAL_CONTRACT = "agentos.external.v1";
export const AGENTOS_EXTERNAL_CAPABILITIES = [
  "mission.dispatch",
  "policy.evaluate",
  "autonomy.evaluate",
  "memory.propose",
  "human_executor.create",
  "outcome.record",
  "runtime.selftest"
];

function id(prefix, seed) {
  return prefix + "_" + crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 20);
}

export function externalDescriptor() {
  return {
    ok: true,
    agentOsVersion: AGENTOS_EXTERNAL_VERSION,
    contract: AGENTOS_EXTERNAL_CONTRACT,
    profile: "agentos-33-10-external-domain-gateway",
    capabilities: [...AGENTOS_EXTERNAL_CAPABILITIES],
    mode: "control_plane_gateway"
  };
}

export function executeExternalOperation(input = {}, now = Date.now()) {
  const operation = String(input.operation || "").trim();
  const domain = String(input.domain || "external").trim().toLowerCase();
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const createdAt = new Date(now).toISOString();

  if (!AGENTOS_EXTERNAL_CAPABILITIES.includes(operation)) {
    return { ok:false, status:400, error:"unsupported_operation", operation };
  }

  let result;
  if (operation === "runtime.selftest") {
    result = { id:id("selftest", domain + "|" + createdAt), state:"PASSED", createdAt, domain };
  } else if (operation === "mission.dispatch") {
    result = {
      id:String(payload.missionId || id("mission", domain + "|" + createdAt + "|" + JSON.stringify(payload))),
      state:"QUEUED", createdAt, domain, accepted:true
    };
  } else if (operation === "policy.evaluate") {
    const deny = payload.hardBlock === true || payload.decision === "DENY";
    const review = payload.review === true || payload.decision === "REVIEW";
    result = {
      id:id("policy", domain + "|" + createdAt + "|" + JSON.stringify(payload)),
      state:deny ? "DENY" : review ? "REVIEW" : "ALLOW",
      createdAt, domain
    };
  } else if (operation === "autonomy.evaluate") {
    const risk = String(payload.risk || "LOW").toUpperCase();
    const requested = String(payload.requestedAutonomy || "SUPERVISED").toUpperCase();
    const approvedLevel = risk === "HIGH" ? "SUPERVISED" : requested;
    result = {
      id:id("autonomy", domain + "|" + createdAt + "|" + JSON.stringify(payload)),
      state:"EVALUATED", createdAt, domain, requestedLevel:requested, approvedLevel,
      requiresHuman:risk === "HIGH" || payload.requiresHuman === true
    };
  } else if (operation === "memory.propose") {
    result = {
      id:id("memory", domain + "|" + createdAt + "|" + JSON.stringify(payload)),
      state:"VALIDATION_REQUIRED", createdAt, domain, authoritative:false
    };
  } else if (operation === "human_executor.create") {
    result = {
      id:id("human", domain + "|" + createdAt + "|" + JSON.stringify(payload)),
      state:"PENDING", createdAt, domain, action:payload.action || null
    };
  } else {
    result = {
      id:id("outcome", domain + "|" + createdAt + "|" + JSON.stringify(payload)),
      state:"RECORDED", createdAt, domain
    };
  }

  return {
    ok:true,
    status:200,
    agentOsVersion:AGENTOS_EXTERNAL_VERSION,
    contract:AGENTOS_EXTERNAL_CONTRACT,
    capabilities:[...AGENTOS_EXTERNAL_CAPABILITIES],
    operation,
    result
  };
}
