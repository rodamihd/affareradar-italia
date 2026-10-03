import crypto from "node:crypto";
import { redisConfig, redisCommand } from "./redis-rest.js";

export const AGENTOS_EXTERNAL_RUNTIME_VERSION = "33.10";
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

const AUTONOMY = { OBSERVE:0, ASSISTED:1, SUPERVISED:2, AUTONOMOUS:3 };

function id(prefix, seed) {
  return prefix + "_" + crypto.createHash("sha256").update(String(seed)).digest("hex").slice(0, 20);
}

function level(value, fallback="SUPERVISED") {
  const v = String(value || fallback).toUpperCase();
  return Object.prototype.hasOwnProperty.call(AUTONOMY, v) ? v : fallback;
}

export function runtimeDescriptor() {
  return {
    ok:true,
    agentOsVersion:AGENTOS_EXTERNAL_RUNTIME_VERSION,
    contract:AGENTOS_EXTERNAL_CONTRACT,
    profile:"agentos-33-10-external-domain-gateway",
    capabilities:[...AGENTOS_EXTERNAL_CAPABILITIES],
    mode:"control_plane_gateway"
  };
}

async function persist(domain, operation, result) {
  if (!redisConfig()) return { persisted:false, reason:"redis_not_configured" };
  const entry = { domain, operation, result, storedAt:new Date().toISOString() };
  const key = "agentos3310:external:" + result.id;
  await redisCommand("SET", key, JSON.stringify(entry), "EX", 7776000);
  await redisCommand("LPUSH", "agentos3310:external:events", JSON.stringify({
    id:result.id, domain, operation, state:result.state || null, createdAt:result.createdAt
  }));
  await redisCommand("LTRIM", "agentos3310:external:events", 0, 999);
  return { persisted:true };
}

export async function executeExternalOperation(input = {}, now = Date.now()) {
  const operation = String(input.operation || "").trim();
  const domain = String(input.domain || "external").trim().toLowerCase();
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const createdAt = new Date(now).toISOString();

  if (!AGENTOS_EXTERNAL_CAPABILITIES.includes(operation)) {
    return { ok:false, status:400, error:"unsupported_operation", capability:operation };
  }

  let result;
  if (operation === "runtime.selftest") {
    result = {
      id:id("selftest", domain + "|" + createdAt),
      state:"PASSED",
      createdAt,
      domain,
      agentOsVersion:AGENTOS_EXTERNAL_RUNTIME_VERSION,
      contract:AGENTOS_EXTERNAL_CONTRACT
    };
  } else if (operation === "mission.dispatch") {
    const missionId = String(payload.missionId || id("mission", domain + "|" + createdAt + "|" + JSON.stringify(payload)));
    result = { id:missionId, state:"QUEUED", createdAt, domain, accepted:true };
  } else if (operation === "policy.evaluate") {
    const hardBlock = payload.hardBlock === true || payload.decision === "DENY";
    const review = payload.review === true || payload.decision === "REVIEW";
    result = {
      id:id("policy", domain + "|" + createdAt + "|" + JSON.stringify(payload)),
      state:hardBlock ? "DENY" : review ? "REVIEW" : "ALLOW",
      createdAt, domain
    };
  } else if (operation === "autonomy.evaluate") {
    const configured = level(process.env.AGENTOS_EXTERNAL_AUTONOMY || "SUPERVISED");
    const requested = level(payload.requestedAutonomy || configured);
    const risk = String(payload.risk || "LOW").toUpperCase();
    const ceiling = risk === "HIGH" ? "SUPERVISED" : configured;
    const approved = Math.min(AUTONOMY[requested], AUTONOMY[ceiling]);
    const approvedLevel = Object.keys(AUTONOMY).find(k => AUTONOMY[k] === approved) || "SUPERVISED";
    result = {
      id:id("autonomy", domain + "|" + createdAt + "|" + JSON.stringify(payload)),
      state:"EVALUATED", createdAt, domain,
      configuredLevel:configured, requestedLevel:requested, approvedLevel,
      requiresHuman:risk === "HIGH" || payload.requiresHuman === true
    };
  } else if (operation === "memory.propose") {
    result = {
      id:id("memory", domain + "|" + createdAt + "|" + JSON.stringify(payload)),
      state:"VALIDATION_REQUIRED", createdAt, domain,
      authoritative:false
    };
  } else if (operation === "human_executor.create") {
    result = {
      id:id("human", domain + "|" + createdAt + "|" + JSON.stringify(payload)),
      state:"PENDING", createdAt, domain,
      action:payload.action || null
    };
  } else {
    result = {
      id:id("outcome", domain + "|" + createdAt + "|" + JSON.stringify(payload)),
      state:"RECORDED", createdAt, domain
    };
  }

  let persistence;
  try {
    persistence = await persist(domain, operation, result);
  } catch (error) {
    persistence = { persisted:false, reason:String(error?.message || error) };
  }

  return {
    ok:true,
    status:200,
    agentOsVersion:AGENTOS_EXTERNAL_RUNTIME_VERSION,
    contract:AGENTOS_EXTERNAL_CONTRACT,
    operation,
    result,
    persistence
  };
}
