import crypto from "node:crypto";
import { redisConfig, redisCommand } from "./redis-rest.js";
import { dealPerformanceScore } from "./deal-performance-score.js";
import { assignStrategyArm, championChallengerVerdict } from "./champion-challenger.js";
import { continuousEdgeValidation } from "./continuous-edge-validation.js";
import { canonicalRejectionReason } from "./rejection-reason-taxonomy.js";

const DECISION_ACTIONS = [
  "PUBLISHED","QUEUED","VERIFY","BLOCK","REJECT","HOLD","DEFER","REVERIFY","OBSERVE","DISCARD","FAILED","OTHER"
];

const OUTCOME_FIELDS = [
  "impressions","clicks","conversions","engagements","publishes","successfulPublishes","revenueEUR"
];

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nonNegative(value) {
  return Math.max(0, Number(value || 0));
}

function compactBody(body = {}) {
  return {
    asin:body.asin || null,
    title:body.title || null,
    category:body.category || null,
    source:body.source || body.signalSource || null,
    dealType:body.dealType || null,
    price:body.effectivePrice || body.price || null,
    oldPrice:body.oldPrice || null,
    discount:body.discount || null,
    dealScore:safeNum(body.dealScore),
    reliabilityScore:safeNum(body.reliabilityScore)
  };
}

function decisionAction(event = "", extra = {}) {
  const name = String(event || "").toLowerCase();
  const adaptive = String(extra?.adaptiveControl?.action || "").toUpperCase();

  if (name === "published") return "PUBLISHED";
  if (name === "queued") return "QUEUED";
  if (name === "verification_required") return "VERIFY";
  if (name === "publish_failed") return "FAILED";
  if (name === "opportunity_not_publishable") {
    const action = String(extra?.opportunity?.action || "").toUpperCase();
    return ["OBSERVE","DISCARD"].includes(action) ? action : "REJECT";
  }
  if (name === "agentos_33_10_adaptive_hold") {
    return ["HOLD","DEFER","REVERIFY"].includes(adaptive) ? adaptive : "HOLD";
  }
  if (
    name === "agentos_33_10_adaptive_block" ||
    name === "agentos_egress_blocked" ||
    name === "safe_mode_blocked"
  ) return "BLOCK";
  if (
    name.includes("blocked") ||
    name.includes("rejected") ||
    name === "revalidation_failed" ||
    name === "reward_validation_failed" ||
    name === "republish_blocked"
  ) return "REJECT";

  return "OTHER";
}

export function classifyDecisionEvent(event = "", extra = {}) {
  return decisionAction(event, extra);
}

function reasonFor(event = "", extra = {}) {
  return (
    extra?.adaptiveControl?.reason ||
    extra?.reason ||
    extra?.policy?.decision ||
    extra?.opportunity?.action ||
    event ||
    null
  );
}

function normalizeReasonCode(value) {
  return canonicalRejectionReason(value);
}

function appendReason(target, code, source, detail = null) {
  if (!code) return;
  const normalized = normalizeReasonCode(code);
  if (target.some(item => item.code === normalized && item.source === source)) return;
  target.push({ code:normalized, source, detail });
}

export function decisionReasonDetails(event = "", extra = {}) {
  const reasons = [];

  const failures = Array.isArray(extra?.failures) ? extra.failures : [];
  for (const failure of failures) {
    if (typeof failure === "string") appendReason(reasons, failure, "failures");
    else if (failure && typeof failure === "object") {
      appendReason(reasons, failure.code || failure.reason, "failures", {
        field:failure.field || null,
        detail:failure.detail || null
      });
    }
  }

  const revalidationFailures = Array.isArray(extra?.revalidation?.failures)
    ? extra.revalidation.failures
    : [];
  for (const failure of revalidationFailures) {
    if (typeof failure === "string") appendReason(reasons, failure, "revalidation");
    else if (failure && typeof failure === "object") {
      appendReason(reasons, failure.code || failure.reason, "revalidation", {
        field:failure.field || null,
        detail:failure.detail || null
      });
    }
  }

  for (const code of extra?.revalidation?.blockingCodes || []) {
    appendReason(reasons, code, "revalidation");
  }

  for (const code of extra?.antiSpam?.failures || []) {
    appendReason(reasons, code, "anti_spam");
  }

  for (const code of extra?.policy?.blocking || []) {
    appendReason(reasons, code, "policy");
  }

  for (const code of extra?.repetition?.failures || []) {
    appendReason(reasons, code, "repetition");
  }

  if (extra?.adaptiveControl?.reason) {
    appendReason(reasons, extra.adaptiveControl.reason, "adaptive_control");
  }
  if (extra?.egress?.reason) {
    appendReason(reasons, extra.egress.reason, "egress");
  }
  if (extra?.trafficSource?.reason) {
    appendReason(reasons, extra.trafficSource.reason, "traffic_source");
  }
  if (extra?.creatorQuality?.reason) {
    appendReason(reasons, extra.creatorQuality.reason, "creator_quality");
  }
  if (extra?.republish?.reason) {
    appendReason(reasons, extra.republish.reason, "republish");
  }
  if (extra?.opportunity?.action && ["DISCARD","OBSERVE","VERIFY"].includes(String(extra.opportunity.action).toUpperCase())) {
    appendReason(reasons, `OPPORTUNITY_${extra.opportunity.action}`, "opportunity");
  }

  if (!reasons.length) appendReason(reasons, reasonFor(event, extra), "event");
  return reasons;
}

export function decisionReasonCodes(event = "", extra = {}) {
  return decisionReasonDetails(event, extra).map(item => item.code);
}

function parseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

async function lastDecisionForDeal(dealId) {
  if (!dealId || !redisConfig()) return null;
  const rr = await redisCommand("GET", `affareradar:decision:last:${dealId}`);
  return parseJson(rr.result);
}

export async function recordDecisionEvent(event = "", body = {}, extra = {}, now = Date.now()) {
  if (!redisConfig()) return { recorded:false, reason:"redis_unavailable" };

  const action = decisionAction(event, extra);
  const dealId = String(
    body.asin ||
    extra.dealId ||
    body.dealId ||
    crypto.createHash("sha256").update(String(body.amazonUrl || body.title || "unknown")).digest("hex").slice(0, 24)
  );

  const at = nowIso(now);
  const decisionId = `decision_${crypto.createHash("sha256").update(`${dealId}|${event}|${at}`).digest("hex").slice(0, 24)}`;
  const strategy = assignStrategyArm(dealId);
  const reasonDetails = decisionReasonDetails(event, extra);
  const reasonCodes = reasonDetails.map(item => item.code);
  const record = {
    decisionId,
    at,
    dealId,
    event:String(event || "unknown"),
    action,
    reason:reasonFor(event, extra),
    reasonCodes,
    reasonDetails,
    offer:compactBody(body),
    agentOsVersion:extra?.releaseManifest?.agentOsVersion || "33.10",
    opportunityScore:safeNum(extra?.opportunity?.score),
    opportunityAction:extra?.opportunity?.action || null,
    predictionScore:safeNum(extra?.prediction?.qualityScore),
    predictionConfidence:extra?.prediction?.confidence || null,
    persistenceScore:safeNum(extra?.persistence?.persistenceScore),
    urgencyScore:safeNum(extra?.persistence?.urgencyScore),
    revenueRPM:safeNum(extra?.revenueAttribution?.calibratedRPM ?? extra?.revenue?.expectedRevenuePer1000ImpressionsEUR),
    sourceReputation:safeNum(extra?.sourceReputation?.score),
    verificationState:extra?.verification?.state || null,
    systemMode:extra?.mode?.mode || null,
    adaptiveAction:extra?.adaptiveControl?.action || null,
    adaptiveReason:extra?.adaptiveControl?.reason || null,
    telegramMessageId:extra?.telegramMessageId || null,
    strategyArm:strategy.arm,
    strategyBucket:strategy.bucket,
    strategyExecutionMode:strategy.executionMode
  };

  const ops = [
    redisCommand("LPUSH", "affareradar:decision:ledger", JSON.stringify(record)),
    redisCommand("LTRIM", "affareradar:decision:ledger", 0, 999),
    redisCommand("SET", `affareradar:decision:last:${dealId}`, JSON.stringify(record), "EX", 7776000),
    redisCommand("INCR", `affareradar:decision:count:${action}`),
    redisCommand("INCR", `affareradar:decision:event:${normalizeReasonCode(event)}`)
  ];

  for (const code of reasonCodes) {
    ops.push(redisCommand("INCR", `affareradar:decision:reason:${code}`));
  }
  await Promise.all(ops);

  return { recorded:true, record };
}

async function aggregateDealOutcome(dealId, record) {
  const key = `affareradar:outcome:deal:${dealId}`;
  const rr = await redisCommand("GET", key);
  const current = parseJson(rr.result) || {
    dealId,
    decisionId:record.decisionId || null,
    decisionAction:record.decisionAction || null,
    firstAt:record.at,
    impressions:0,
    clicks:0,
    conversions:0,
    engagements:0,
    publishes:0,
    successfulPublishes:0,
    revenueEUR:0
  };

  const next = { ...current };
  for (const field of OUTCOME_FIELDS) {
    next[field] = Number(next[field] || 0) + Number(record[field] || 0);
  }
  next.lastAt = record.at;
  next.decisionId = next.decisionId || record.decisionId || null;
  next.decisionAction = next.decisionAction || record.decisionAction || null;
  next.asin = record.asin || next.asin || null;
  next.category = record.category || next.category || null;
  next.source = record.source || next.source || null;
  next.dealType = record.dealType || next.dealType || null;
  next.telegramMessageId = record.telegramMessageId || next.telegramMessageId || null;

  next.performance = dealPerformanceScore(next, {
    priorScore:Number(process.env.AFFARERADAR_PERFORMANCE_PRIOR_SCORE || 50)
  });
  const decision = await lastDecisionForDeal(dealId);
  next.edgeValidation = continuousEdgeValidation(decision || {}, next);
  next.strategyArm = decision?.strategyArm || next.strategyArm || null;
  await redisCommand("SET", key, JSON.stringify(next), "EX", 7776000);
  await redisCommand("ZADD", "affareradar:performance:deals", String(next.performance.score), dealId);
  if (next.strategyArm) {
    await redisCommand("SET", `affareradar:strategy:deal:${dealId}`, next.strategyArm, "EX", 7776000);
    if (record.impressions) await redisCommand("INCRBY", `affareradar:strategy:${next.strategyArm}:impressions`, record.impressions);
    if (record.clicks) await redisCommand("INCRBY", `affareradar:strategy:${next.strategyArm}:clicks`, record.clicks);
    if (record.conversions) await redisCommand("INCRBY", `affareradar:strategy:${next.strategyArm}:conversions`, record.conversions);
    if (record.revenueEUR) await redisCommand("INCRBYFLOAT", `affareradar:strategy:${next.strategyArm}:revenueEUR`, record.revenueEUR);
  }
  return next;
}

export async function getDealOutcomeSnapshot(dealId) {
  if (!redisConfig() || !dealId) return null;
  const rr = await redisCommand("GET", `affareradar:outcome:deal:${dealId}`);
  return parseJson(rr.result);
}

export async function recordOutcomeRegistryEvent(input = {}, now = Date.now()) {
  if (!redisConfig()) return { recorded:false, reason:"redis_unavailable" };

  const body = input.body && typeof input.body === "object" ? input.body : input;
  const dealId = String(input.dealId || body.asin || body.dealId || "unknown");
  const externalEventId = String(input.externalEventId || "").trim();

  if (externalEventId) {
    const idem = crypto.createHash("sha256").update(externalEventId).digest("hex").slice(0, 40);
    const lock = await redisCommand("SET", `affareradar:outcome:registry:idempotency:${idem}`, "1", "NX", "EX", 31536000);
    if (lock.result !== "OK") return { recorded:false, duplicate:true, externalEventId };
  }

  const at = input.occurredAt || nowIso(now);
  const decision = await lastDecisionForDeal(dealId);
  const record = {
    outcomeId:externalEventId || `outcome_${crypto.createHash("sha256").update(`${dealId}|${at}|${Math.random()}`).digest("hex").slice(0, 24)}`,
    externalEventId:externalEventId || null,
    at,
    dealId,
    decisionId:decision?.decisionId || input.decisionId || null,
    decisionAction:decision?.action || input.decisionAction || null,
    telegramMessageId:decision?.telegramMessageId || input.telegramMessageId || null,
    asin:body.asin || input.asin || null,
    category:body.category || input.category || null,
    source:body.source || input.source || null,
    dealType:body.dealType || input.dealType || null,
    reportSource:input.reportSource || null,
    impressions:nonNegative(input.impressions),
    clicks:nonNegative(input.clicks),
    conversions:nonNegative(input.conversions),
    engagements:nonNegative(input.engagements),
    publishes:nonNegative(input.publishes),
    successfulPublishes:nonNegative(input.successfulPublishes),
    revenueEUR:nonNegative(input.revenueEUR)
  };

  const ops = [
    redisCommand("LPUSH", "affareradar:outcome:registry", JSON.stringify(record)),
    redisCommand("LTRIM", "affareradar:outcome:registry", 0, 999)
  ];

  for (const field of OUTCOME_FIELDS) {
    if (!record[field]) continue;
    if (field === "revenueEUR") {
      ops.push(redisCommand("INCRBYFLOAT", `affareradar:outcome:total:${field}`, record[field]));
    } else {
      ops.push(redisCommand("INCRBY", `affareradar:outcome:total:${field}`, record[field]));
    }
  }

  await Promise.all(ops);
  const dealOutcome = await aggregateDealOutcome(dealId, record);
  return { recorded:true, record, dealOutcome };
}

export async function recordPublicationOutcome(body = {}, meta = {}) {
  return recordOutcomeRegistryEvent({
    body,
    dealId:meta.dealId || body.asin || body.dealId,
    occurredAt:meta.occurredAt,
    reportSource:meta.reportSource || "affareradar_publish",
    telegramMessageId:meta.telegramMessageId || null,
    publishes:1,
    successfulPublishes:meta.success === false ? 0 : 1
  });
}

function parseRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map(item => {
    try { return JSON.parse(item); } catch { return null; }
  }).filter(Boolean);
}

export async function missionControlSnapshot() {
  if (!redisConfig()) {
    return {
      available:false,
      decisions:{},
      outcomes:{ impressions:0, clicks:0, conversions:0, engagements:0, publishes:0, successfulPublishes:0, revenueEUR:0 },
      recentDecisions:[],
      recentOutcomes:[]
    };
  }

  const decisionResults = await Promise.all(
    DECISION_ACTIONS.map(action => redisCommand("GET", `affareradar:decision:count:${action}`))
  );

  const [
    impressions,
    clicks,
    conversions,
    engagements,
    publishes,
    successfulPublishes,
    revenue,
    recentDecisions,
    recentOutcomes,
    championImpressions,
    challengerImpressions,
    championRevenue,
    challengerRevenue
  ] = await Promise.all([
    redisCommand("GET", "affareradar:outcome:total:impressions"),
    redisCommand("GET", "affareradar:outcome:total:clicks"),
    redisCommand("GET", "affareradar:outcome:total:conversions"),
    redisCommand("GET", "affareradar:outcome:total:engagements"),
    redisCommand("GET", "affareradar:outcome:total:publishes"),
    redisCommand("GET", "affareradar:outcome:total:successfulPublishes"),
    redisCommand("GET", "affareradar:outcome:total:revenueEUR"),
    redisCommand("LRANGE", "affareradar:decision:ledger", 0, 49),
    redisCommand("LRANGE", "affareradar:outcome:registry", 0, 49),
    redisCommand("GET", "affareradar:strategy:CHAMPION:impressions"),
    redisCommand("GET", "affareradar:strategy:CHALLENGER:impressions"),
    redisCommand("GET", "affareradar:strategy:CHAMPION:revenueEUR"),
    redisCommand("GET", "affareradar:strategy:CHALLENGER:revenueEUR")
  ]);

  const decisions = {};
  DECISION_ACTIONS.forEach((action, i) => {
    decisions[action] = Number(decisionResults[i]?.result || 0);
  });

  const championChallenger = championChallengerVerdict({
    CHAMPION:{
      impressions:Number(championImpressions.result || 0),
      revenueEUR:Number(championRevenue.result || 0)
    },
    CHALLENGER:{
      impressions:Number(challengerImpressions.result || 0),
      revenueEUR:Number(challengerRevenue.result || 0)
    }
  });

  return {
    available:true,
    decisions,
    outcomes:{
      impressions:Number(impressions.result || 0),
      clicks:Number(clicks.result || 0),
      conversions:Number(conversions.result || 0),
      engagements:Number(engagements.result || 0),
      publishes:Number(publishes.result || 0),
      successfulPublishes:Number(successfulPublishes.result || 0),
      revenueEUR:Number(revenue.result || 0)
    },
    championChallenger,
    recentDecisions:parseRows(recentDecisions.result),
    recentOutcomes:parseRows(recentOutcomes.result)
  };
}
