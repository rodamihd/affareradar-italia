import crypto from "node:crypto";
import { redisConfig, redisCommand } from "./redis-rest.js";

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
  const record = {
    decisionId,
    at,
    dealId,
    event:String(event || "unknown"),
    action,
    reason:reasonFor(event, extra),
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
    telegramMessageId:extra?.telegramMessageId || null
  };

  await Promise.all([
    redisCommand("LPUSH", "affareradar:decision:ledger", JSON.stringify(record)),
    redisCommand("LTRIM", "affareradar:decision:ledger", 0, 999),
    redisCommand("SET", `affareradar:decision:last:${dealId}`, JSON.stringify(record), "EX", 7776000),
    redisCommand("INCR", `affareradar:decision:count:${action}`)
  ]);

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

  await redisCommand("SET", key, JSON.stringify(next), "EX", 7776000);
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
    recentOutcomes
  ] = await Promise.all([
    redisCommand("GET", "affareradar:outcome:total:impressions"),
    redisCommand("GET", "affareradar:outcome:total:clicks"),
    redisCommand("GET", "affareradar:outcome:total:conversions"),
    redisCommand("GET", "affareradar:outcome:total:engagements"),
    redisCommand("GET", "affareradar:outcome:total:publishes"),
    redisCommand("GET", "affareradar:outcome:total:successfulPublishes"),
    redisCommand("GET", "affareradar:outcome:total:revenueEUR"),
    redisCommand("LRANGE", "affareradar:decision:ledger", 0, 49),
    redisCommand("LRANGE", "affareradar:outcome:registry", 0, 49)
  ]);

  const decisions = {};
  DECISION_ACTIONS.forEach((action, i) => {
    decisions[action] = Number(decisionResults[i]?.result || 0);
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
    recentDecisions:parseRows(recentDecisions.result),
    recentOutcomes:parseRows(recentOutcomes.result)
  };
}
