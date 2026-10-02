import {
  resolveSignalIntent as resolveSignalIntent175,
  mixedModeForTask as mixedModeForTask175,
  routingPlan as routingPlan175,
  freshnessSla as freshnessSla175,
  egressGuard as egressGuard175,
  releaseManifest as releaseManifest175,
  knowledgeProposal as knowledgeProposal175,
  semanticDecisionCachePolicy as semanticDecisionCachePolicy175
} from "./agentos-17_5-profile.js";

export const AGENTOS_PROFILE_VERSION = "26.0";

function retag(value = {}) {
  return value && typeof value === "object"
    ? { ...value, version:"26.0" }
    : value;
}

function commercialPriceData(body = {}) {
  return Boolean(
    body.price ||
    body.oldPrice ||
    body.effectivePrice ||
    body.discount ||
    body.coupon ||
    body.stack
  );
}

function verifiedAtMs(body = {}, verification = {}) {
  const raw =
    body.lastVerifiedAt ||
    body.verifiedAt ||
    body.verificationTime ||
    verification.verifiedAt ||
    null;
  const parsed = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveSignalIntent(body = {}) {
  return retag(resolveSignalIntent175(body));
}

export function mixedModeForTask(taskType = "") {
  return mixedModeForTask175(taskType);
}

export function routingPlan(taskType = "", ctx = {}) {
  return { ...routingPlan175(taskType, ctx), agentOsVersion:"26.0" };
}

export function freshnessSla(body = {}, verification = {}, now = Date.now()) {
  const base = freshnessSla175(body, verification, now);

  if (!commercialPriceData(body) || body.rewardProgram) {
    return retag(base);
  }

  const maxAgeMinutes = Math.max(
    1,
    Number(process.env.AGENTOS_PRICE_FRESHNESS_MINUTES || 5)
  );
  const verifiedAt = verifiedAtMs(body, verification);
  const ageMinutes = verifiedAt === null
    ? null
    : Math.max(0, (now - verifiedAt) / 60000);
  const fresh = ageMinutes !== null && ageMinutes <= maxAgeMinutes;

  return {
    ...base,
    version:"26.0",
    verifiedAt:verifiedAt === null ? null : new Date(verifiedAt).toISOString(),
    ageMinutes:ageMinutes === null ? null : Number(ageMinutes.toFixed(2)),
    maxAgeMinutes,
    state:fresh ? "FRESH" : "STALE",
    refreshRequired:!fresh,
    policy:"AFFARERADAR_PRICE_FRESHNESS_5M"
  };
}

export function egressGuard(body = {}, ctx = {}) {
  return retag(egressGuard175(body, ctx));
}

export function releaseManifest(extra = {}) {
  const base = releaseManifest175(extra);
  return {
    ...base,
    agentOsVersion:"26.0",
    profile:"affareradar-agentos-26.0",
    supervisor:"offerteradar-supervisor-v1",
    opportunityContract:"affareradar.opportunity.v1"
  };
}

export function knowledgeProposal(body = {}, ctx = {}) {
  return retag(knowledgeProposal175(body, ctx));
}

export function semanticDecisionCachePolicy(body = {}, ctx = {}) {
  return retag(semanticDecisionCachePolicy175(body, ctx));
}
