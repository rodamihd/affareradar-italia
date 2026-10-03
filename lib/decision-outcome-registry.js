import crypto from "node:crypto";
import { redisConfig, redisCommand } from "./redis-rest.js";

const DECISION_ACTIONS = [
  "PUBLISHED","QUEUED","VERIFY","BLOCK","REJECT","HOLD","DEFER","REVERIFY","OBSERVE","DISCARD","FAILED","OTHER"
];

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

export async function recordOutcomeRegistryEvent(input = {}, now = Date.now()) {
  if (!redisConfig()) return { recorded:false, reason:"redis_unavailable" };

  const body = input.body && typeof input.body === "object" ? input.body : input;
  const dealId = String(input.dealId || body.asin || body.dealId || "unknown");
  const at = input.occurredAt || nowIso(now);
  const record = {
    outcomeId:input.externalEventId || `outcome_${crypto.createHash("sha256").update(`${dealId}|${at}|${Math.random()}`).digest("hex").slice(0, 24)}`,
    at,
    dealId,
    asin:body.asin || input.asin || null,
    category:body.category || null,
    source:body.source || input.source || null,
    dealType:body.dealType || null,
    reportSource:input.reportSource || null,
    impressions:Math.max(0, Number(input.impressions || 0)),
    clicks:Math.max(0, Number(input.clicks || 0)),
    conversions:Math.max(0, Number(input.conversions || 0)),
    engagements:Math.max(0, Number(input.engagements || 0)),
    revenueEUR:Math.max(0, Number(input.revenueEUR || 0))
  };

  const ops = [
    redisCommand("LPUSH", "affareradar:outcome:registry", JSON.stringify(record)),
    redisCommand("LTRIM", "affareradar:outcome:registry", 0, 999)
  ];

  if (record.impressions) ops.push(redisCommand("INCRBY", "affareradar:outcome:total:impressions", record.impressions));
  if (record.clicks) ops.push(redisCommand("INCRBY", "affareradar:outcome:total:clicks", record.clicks));
  if (record.conversions) ops.push(redisCommand("INCRBY", "affareradar:outcome:total:conversions", record.conversions));
  if (record.engagements) ops.push(redisCommand("INCRBY", "affareradar:outcome:total:engagements", record.engagements));
  if (record.revenueEUR) ops.push(redisCommand("INCRBYFLOAT", "affareradar:outcome:total:revenueEUR", record.revenueEUR));

  await Promise.all(ops);
  return { recorded:true, record };
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
      outcomes:{ impressions:0, clicks:0, conversions:0, engagements:0, revenueEUR:0 },
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
    revenue,
    recentDecisions,
    recentOutcomes
  ] = await Promise.all([
    redisCommand("GET", "affareradar:outcome:total:impressions"),
    redisCommand("GET", "affareradar:outcome:total:clicks"),
    redisCommand("GET", "affareradar:outcome:total:conversions"),
    redisCommand("GET", "affareradar:outcome:total:engagements"),
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
      revenueEUR:Number(revenue.result || 0)
    },
    recentDecisions:parseRows(recentDecisions.result),
    recentOutcomes:parseRows(recentOutcomes.result)
  };
}
