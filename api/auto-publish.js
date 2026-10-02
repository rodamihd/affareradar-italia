import { channelPlan } from "../lib/channel-strategy.js";
import { evaluateStorefrontCandidate, storefrontContent } from "../lib/storefront-intelligence.js";
import { creatorQualityScore, publishingWindow } from "../lib/creator-quality.js";
import { evaluateRepublish } from "../lib/republish-intelligence.js";
import { evaluateAmazonReward, rewardContent } from "../lib/rewards-engine.js";
import { evaluateRepetition, evaluateTrafficSource, evidenceRecord, transformExternalEditorial, evaluateOriginality } from "../lib/creator-compliance.js";
import { sanitizeForAmazonPublication } from "../lib/amazon-compliance.js";
import { evaluateAmazonVerification } from "../lib/amazon-verification-broker.js";
import { opportunityScoreV2 } from "../lib/opportunity-engine-v2.js";
import { evaluatePolicies } from "../lib/policy-engine.js";
import { computeSourceReputation, initialSourceReputation, sourceKey } from "../lib/source-reputation.js";
import crypto from "node:crypto";

const memory = globalThis.__affareRadarState || {
  published:new Map(),
  lifecycle:new Map(),
  recentGlobal:[],
  recentByCategory:new Map()
};
globalThis.__affareRadarState = memory;

function hash(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

function buildFingerprint(body) {
  const asin = String(body.asin || "").trim().toUpperCase();
  const price = String(body.effectivePrice || body.price || "").trim();
  const coupon = String(body.coupon || "").trim();
  const stack = String(body.stack || "").trim();
  const type = String(body.dealType || "").trim().toLowerCase();
  return [asin || String(body.amazonUrl || "").trim(), price, coupon, stack, type].join("|");
}

function buildDealId(body) {
  const asin = String(body.asin || "").trim().toUpperCase();
  return asin || hash(String(body.amazonUrl || body.title || "unknown")).slice(0, 24);
}

function normalizeCategory(value) {
  return String(value || "other").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
}

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url:url.replace(/\/$/, ""), token } : null;
}

async function redisCommand(command, ...args) {
  const cfg = redisConfig();
  if (!cfg) return { configured:false, result:null };

  const r = await fetch(cfg.url, {
    method:"POST",
    headers:{
      Authorization:`Bearer ${cfg.token}`,
      "Content-Type":"application/json"
    },
    body:JSON.stringify([command, ...args])
  });

  if (!r.ok) throw new Error(`redis_${String(command).toLowerCase()}_${r.status}`);
  const data = await r.json();
  return { configured:true, result:data.result ?? null };
}

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

async function trackMetric(event, body, extra = {}) {
  const payload = {
    event,
    at:nowIso(),
    dealId:buildDealId(body),
    asin:body.asin || null,
    title:body.title || null,
    category:body.category || null,
    dealType:body.dealType || null,
    dealScore:Number.isFinite(Number(body.dealScore)) ? Number(body.dealScore) : null,
    reliabilityScore:Number.isFinite(Number(body.reliabilityScore)) ? Number(body.reliabilityScore) : null,
    price:body.price || null,
    effectivePrice:body.effectivePrice || body.price || null,
    discount:body.discount || null,
    coupon:body.coupon || null,
    amazonUrl:body.amazonUrl || null,
    prime:body.prime === true,
    ...extra
  };

  try {
    if (redisConfig()) {
      await Promise.all([
        redisCommand("INCR", `affareradar:metrics:${event}`),
        redisCommand("LPUSH", "affareradar:events", JSON.stringify(payload))
      ]);
      await redisCommand("LTRIM", "affareradar:events", 0, 199);
    }
  } catch {}
}

function parseTimestamp(value) {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function validateAmazonUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    return host === "amazon.it" || host.endsWith(".amazon.it") || host === "amzn.eu";
  } catch {
    return false;
  }
}

function revalidate(body, now) {
  const mode = String(process.env.REVALIDATION_MODE || "soft").toLowerCase();
  const maxAgeMinutes = Number(process.env.REVALIDATION_MAX_AGE_MINUTES || 10);
  const maxAgeMs = Math.max(1, maxAgeMinutes) * 60 * 1000;
  const verifiedAtRaw = body.lastVerifiedAt || body.verifiedAt || body.verificationTime;
  const verifiedAt = parseTimestamp(verifiedAtRaw);
  const warnings = [];
  const failures = [];

  if (!validateAmazonUrl(body.amazonUrl)) {
    failures.push("invalid_amazon_url");
  }

  if (verifiedAt) {
    const age = now - verifiedAt;
    if (age < -60 * 1000) failures.push("verification_timestamp_in_future");
    if (age > maxAgeMs) failures.push("stale_verification");
  } else if (mode === "strict") {
    failures.push("missing_verification_timestamp");
  } else {
    warnings.push("missing_verification_timestamp");
  }

  if (body.priceVerified === false) failures.push("price_not_verified");
  else if (body.priceVerified !== true) {
    if (mode === "strict") failures.push("missing_price_verification");
    else warnings.push("missing_price_verification");
  }

  const hasCoupon = Boolean(body.coupon || body.stack || String(body.dealType || "").toLowerCase() === "coupon_stack");
  if (hasCoupon) {
    if (body.couponVerified === false) failures.push("coupon_not_verified");
    else if (body.couponVerified !== true) {
      if (mode === "strict") failures.push("missing_coupon_verification");
      else warnings.push("missing_coupon_verification");
    }
  }

  if (body.stock === false || String(body.stock).toLowerCase() === "out_of_stock") {
    failures.push("out_of_stock");
  }

  return {
    passed:failures.length === 0,
    mode,
    maxAgeMinutes,
    verifiedAt:verifiedAt ? new Date(verifiedAt).toISOString() : null,
    failures,
    warnings
  };
}

function cleanupMemory(now) {
  const maxAge = 24 * 60 * 60 * 1000;
  memory.recentGlobal = memory.recentGlobal.filter(ts => now - ts < maxAge);
  for (const [category, entries] of memory.recentByCategory.entries()) {
    const clean = entries.filter(ts => now - ts < maxAge);
    if (clean.length) memory.recentByCategory.set(category, clean);
    else memory.recentByCategory.delete(category);
  }
  for (const [key, value] of memory.published.entries()) {
    if (now - value > maxAge) memory.published.delete(key);
  }
}

async function getAntiSpamState(category, now) {
  const hourBucket = Math.floor(now / 3600000);
  const globalKey = `affareradar:rate:global:${hourBucket}`;
  const categoryKey = `affareradar:rate:category:${category}:${hourBucket}`;
  const lastKey = "affareradar:rate:last_publish";

  try {
    const [globalCount, categoryCount, lastPublish] = await Promise.all([
      redisCommand("GET", globalKey),
      redisCommand("GET", categoryKey),
      redisCommand("GET", lastKey)
    ]);

    if (globalCount.configured) {
      return {
        mode:"persistent_upstash_redis",
        globalKey,
        categoryKey,
        lastKey,
        globalCount:Number(globalCount.result || 0),
        categoryCount:Number(categoryCount.result || 0),
        lastPublishAt:Number(lastPublish.result || 0) || null
      };
    }
  } catch {}

  cleanupMemory(now);
  const hourAgo = now - 3600000;
  return {
    mode:"best_effort_in_memory",
    globalKey:null,
    categoryKey:null,
    lastKey:null,
    globalCount:memory.recentGlobal.filter(ts => ts >= hourAgo).length,
    categoryCount:(memory.recentByCategory.get(category) || []).filter(ts => ts >= hourAgo).length,
    lastPublishAt:memory.recentGlobal.length ? memory.recentGlobal[memory.recentGlobal.length - 1] : null
  };
}

function evaluateAntiSpam(state, body, now) {
  const maxPerHour = Number(process.env.ANTISPAM_MAX_PER_HOUR || 8);
  const maxPerCategoryHour = Number(process.env.ANTISPAM_MAX_PER_CATEGORY_HOUR || 3);
  const minGapMinutes = Number(process.env.ANTISPAM_MIN_GAP_MINUTES || 5);
  const minGapMs = Math.max(0, minGapMinutes) * 60 * 1000;

  const dealScore = Number(body.dealScore);
  const reliability = Number(body.reliabilityScore);
  const dealType = String(body.dealType || "").toLowerCase();
  const priority = String(body.priority || "").toLowerCase();
  const critical =
    priority === "critical" ||
    (Number.isFinite(dealScore) && dealScore >= 98) ||
    (dealType === "price_error" && Number.isFinite(reliability) && reliability >= 95);

  const failures = [];

  if (state.globalCount >= maxPerHour) failures.push("global_hourly_limit");
  if (!critical && state.categoryCount >= maxPerCategoryHour) failures.push("category_hourly_limit");
  if (!critical && state.lastPublishAt && now - state.lastPublishAt < minGapMs) failures.push("minimum_gap");

  return {
    passed:failures.length === 0,
    critical,
    failures,
    limits:{ maxPerHour, maxPerCategoryHour, minGapMinutes },
    current:{ globalCount:state.globalCount, categoryCount:state.categoryCount }
  };
}

async function enqueueDeal(body, dealId, dueAt, reason) {
  const queueKey = "affareradar:queue";
  const itemKey = `affareradar:queue:item:${dealId}`;
  const payload = {
    body,
    dealId,
    dueAt,
    queuedAt:nowIso(),
    reason,
    attempts:Number(body.__queueAttempts || 0)
  };

  try {
    const cfg = redisConfig();
    if (cfg) {
      await redisCommand("SET", itemKey, JSON.stringify(payload), "EX", 86400);
      await redisCommand("ZADD", queueKey, String(dueAt), dealId);
      return { queued:true, mode:"persistent_upstash_redis", dueAt:nowIso(dueAt) };
    }
  } catch {}

  if (!memory.queue) memory.queue = new Map();
  memory.queue.set(dealId, payload);
  return { queued:true, mode:"best_effort_in_memory", dueAt:nowIso(dueAt) };
}

function computeQueueDueAt(antiSpamState, antiSpam, now) {
  const minGapMinutes = Number(process.env.ANTISPAM_MIN_GAP_MINUTES || 5);
  const minGapMs = Math.max(1, minGapMinutes) * 60 * 1000;
  const failures = antiSpam.failures || [];

  if (failures.includes("minimum_gap") && antiSpamState.lastPublishAt) {
    return Math.max(now + 60 * 1000, antiSpamState.lastPublishAt + minGapMs + 5000);
  }

  if (failures.includes("global_hourly_limit") || failures.includes("category_hourly_limit")) {
    const nextHour = (Math.floor(now / 3600000) + 1) * 3600000;
    return nextHour + 60 * 1000;
  }

  return now + minGapMs;
}

async function recordAntiSpam(state, category, now) {
  if (state.mode === "persistent_upstash_redis") {
    try {
      await Promise.all([
        redisCommand("INCR", state.globalKey),
        redisCommand("INCR", state.categoryKey),
        redisCommand("SET", state.lastKey, String(now), "EX", 86400)
      ]);
      await Promise.all([
        redisCommand("EXPIRE", state.globalKey, 7200),
        redisCommand("EXPIRE", state.categoryKey, 7200)
      ]);
      return;
    } catch {}
  }

  memory.recentGlobal.push(now);
  const list = memory.recentByCategory.get(category) || [];
  list.push(now);
  memory.recentByCategory.set(category, list);
}

async function readLifecycle(dealId) {
  const key = `affareradar:lifecycle:${dealId}`;
  try {
    const remote = await redisCommand("GET", key);
    if (remote.configured && remote.result) {
      try {
        return { mode:"persistent_upstash_redis", key, value:JSON.parse(remote.result) };
      } catch {}
    }
    if (remote.configured) return { mode:"persistent_upstash_redis", key, value:null };
  } catch {}

  return { mode:"best_effort_in_memory", key, value:memory.lifecycle.get(dealId) || null };
}

async function writeLifecycle(store, dealId, value) {
  if (store.mode === "persistent_upstash_redis") {
    try {
      await redisCommand("SET", store.key, JSON.stringify(value), "EX", 604800);
      return;
    } catch {}
  }
  memory.lifecycle.set(dealId, value);
}

function nextLifecycle(previous, body, now) {
  const effectivePrice = String(body.effectivePrice || body.price || "").trim();
  const previousPrice = previous?.effectivePrice || null;
  const state = previous ? (previousPrice && previousPrice !== effectivePrice ? "UPDATED" : "PUBLISHED") : "PUBLISHED";

  return {
    dealId:buildDealId(body),
    status:state,
    firstSeenAt:previous?.firstSeenAt || nowIso(now),
    lastVerifiedAt:body.lastVerifiedAt || body.verifiedAt || body.verificationTime || nowIso(now),
    lastPublishedAt:nowIso(now),
    effectivePrice,
    dealScore:Number.isFinite(Number(body.dealScore)) ? Number(body.dealScore) : null,
    reliabilityScore:Number.isFinite(Number(body.reliabilityScore)) ? Number(body.reliabilityScore) : null,
    category:body.category || null,
    publishCount:Number(previous?.publishCount || 0) + 1
  };
}

async function dedupeCheck(fingerprint, now, cooldownSeconds) {
  const key = `affareradar:published:${hash(fingerprint)}`;

  try {
    const remote = await redisCommand("GET", key);
    if (remote.configured) {
      if (remote.result) return { duplicate:true, mode:"persistent_upstash_redis", key };
      const lock = await redisCommand("SET", key, String(now), "NX", "EX", cooldownSeconds);
      if (lock.result !== "OK") return { duplicate:true, mode:"persistent_upstash_redis", key };
      return { duplicate:false, mode:"persistent_upstash_redis", key };
    }
  } catch {}

  const last = memory.published.get(fingerprint);
  if (last && now - last < cooldownSeconds * 1000) {
    return { duplicate:true, mode:"best_effort_in_memory", key:null };
  }

  memory.published.set(fingerprint, now);
  return { duplicate:false, mode:"best_effort_in_memory", key:null };
}

async function readSourceReputation(body) {
  const base = initialSourceReputation(body);
  if (!redisConfig()) return base;
  try {
    const key = sourceKey(body);
    const rr = await redisCommand("GET", `affareradar:source:stats:${key}`);
    if (!rr.result) return base;
    const stats = JSON.parse(rr.result);
    return computeSourceReputation(stats, body);
  } catch {
    return base;
  }
}

async function rollbackDedupe(dedupe, fingerprint) {
  if (dedupe.mode === "persistent_upstash_redis" && dedupe.key) {
    try { await redisCommand("DEL", dedupe.key); } catch {}
  } else {
    memory.published.delete(fingerprint);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  const secret = process.env.PUBLISH_SECRET;
  const auth = req.headers["x-affareradar-secret"];
  if (!secret || auth !== secret) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  const now = Date.now();
  const rawBody = req.body || {};
  const editorial = transformExternalEditorial(rawBody);
  const publication = sanitizeForAmazonPublication(editorial.body, now);
  const body = publication.body;
  const originality = evaluateOriginality(body);

  if (!originality.passed) {
    await trackMetric("originality_blocked", body, { originality });
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"originality_transformation_required",
      lifecycle:"DISCOVERED",
      originality
    });
  }

  const promotionExpiry = body.promotionValidUntil ? Date.parse(body.promotionValidUntil) : null;
  if (body.promotionTimeLimited === true && Number.isFinite(promotionExpiry) && promotionExpiry < now) {
    await trackMetric("promotion_expired_blocked", body, { promotionValidUntil:body.promotionValidUntil });
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"promotion_expired",
      lifecycle:"EXPIRED",
      promotionValidUntil:body.promotionValidUntil
    });
  }

  if (publication.productEligibility && !publication.productEligibility.passed) {
    await trackMetric("product_excluded_blocked", body, { productEligibility:publication.productEligibility });
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"product_not_eligible",
      lifecycle:"DISCOVERED",
      productEligibility:publication.productEligibility
    });
  }

  const dealScore = Number(body.dealScore);
  const reliabilityScore = Number(body.reliabilityScore);
  const dealType = String(body.dealType || "").toLowerCase();
  const reward = evaluateAmazonReward(body, now);
  const isReward = reward.isReward;

  const minDealScore = Number(process.env.AUTO_PUBLISH_MIN_DEAL_SCORE || 90);
  const minReliability = Number(process.env.AUTO_PUBLISH_MIN_RELIABILITY || 85);
  const cooldownMinutes = Number(process.env.AUTO_PUBLISH_COOLDOWN_MINUTES || 180);
  const cooldownSeconds = Math.max(60, Math.floor(Math.max(1, cooldownMinutes) * 60));

  const scorePass = Number.isFinite(dealScore) && dealScore >= minDealScore;
  const specialType = dealType === "price_error" || dealType === "coupon_stack";
  const reliabilityPass = specialType && Number.isFinite(reliabilityScore) && reliabilityScore >= minReliability;
  const rewardPass = isReward && reward.eligible;

  if (isReward && !reward.eligible) {
    await trackMetric("reward_validation_failed", body, { reward });
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"reward_validation_failed",
      lifecycle:"DISCOVERED",
      reward
    });
  }

  if (!scorePass && !reliabilityPass && !rewardPass) {
    await trackMetric("rejected_below_threshold", body);
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"below_threshold",
      lifecycle:"DISCOVERED",
      thresholds:{ minDealScore, minReliability },
    distribution:channelPlan(body)
    });
  }

  const revalidation = isReward
    ? {
        passed:validateAmazonUrl(body.amazonUrl),
        mode:"reward",
        failures:validateAmazonUrl(body.amazonUrl) ? [] : ["invalid_amazon_url"],
        warnings:[]
      }
    : revalidate(body, now);
  const dealId = buildDealId(body);

  const trafficSource = evaluateTrafficSource("telegram");
  if (!trafficSource.passed) {
    await trackMetric("traffic_source_blocked", body, { trafficSource });
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"traffic_source_not_authorized",
      lifecycle:"VERIFIED",
      trafficSource
    });
  }

  let recentContent = [];
  try {
    if (redisConfig()) {
      const rr = await redisCommand("LRANGE", "affareradar:events", 0, 39);
      const rows = Array.isArray(rr.result) ? rr.result : [];
      recentContent = rows.map(x => {
        try { return JSON.parse(x); } catch { return null; }
      }).filter(x => x && x.event === "published");
    }
  } catch {}

  const repetition = evaluateRepetition({ ...body, dealId }, recentContent);
  if (!repetition.passed) {
    await trackMetric("repetition_blocked", body, { repetition, trafficSource });
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"content_repetition_blocked",
      lifecycle:"VERIFIED",
      repetition,
      trafficSource
    });
  }

  const lifecycleStore = await readLifecycle(dealId);
  const creatorQuality = creatorQualityScore(body);
  const window = publishingWindow(new Date(now));
  const verification = evaluateAmazonVerification(body, now);
  const sourceReputation = await readSourceReputation(body);
  const policy = evaluatePolicies(body, {
    verification,
    publication,
    originality,
    repetition,
    trafficSource,
    promotionExpired:false,
    disclosurePresent:true
  });
  const opportunity = opportunityScoreV2(body, {
    verification,
    sourceReputation,
    creatorQuality,
    policy,
    trafficSource,
    originality,
    repetition
  }, now);

  if (policy.blocking.length) {
    await trackMetric("policy_blocked", body, { policy, verification, sourceReputation, opportunity });
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"policy_blocked",
      lifecycle:lifecycleStore.value?.status || "VERIFIED",
      policy,
      verification,
      sourceReputation,
      opportunity
    });
  }

  if (!isReward && opportunity.action === "VERIFY") {
    await trackMetric("verification_required", body, { policy, verification, sourceReputation, opportunity });
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"verify",
      reason:"amazon_verification_required",
      lifecycle:lifecycleStore.value?.status || "DISCOVERED",
      policy,
      verification,
      sourceReputation,
      opportunity
    });
  }

  if (!isReward && (opportunity.action === "DISCARD" || opportunity.action === "OBSERVE")) {
    await trackMetric("opportunity_not_publishable", body, { policy, verification, sourceReputation, opportunity });
    return res.status(200).json({
      ok:true,
      published:false,
      decision:opportunity.action.toLowerCase(),
      reason:"opportunity_engine_v2",
      lifecycle:lifecycleStore.value?.status || "DISCOVERED",
      policy,
      verification,
      sourceReputation,
      opportunity
    });
  }

  if (!isReward && !creatorQuality.passed && dealType !== "price_error") {
    await trackMetric("rejected_creator_quality", body, { creatorQuality, window });
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"creator_quality_below_threshold",
      lifecycle:lifecycleStore.value?.status || "VERIFIED",
      creatorQuality,
      publishingWindow:window
    });
  }

  const republish = evaluateRepublish(lifecycleStore.value, body, now);
  if (!republish.allowed) {
    await trackMetric("republish_blocked", body, { republish, creatorQuality, window });
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"republish_blocked",
      lifecycle:lifecycleStore.value?.status || "PUBLISHED",
      republish,
      creatorQuality,
      publishingWindow:window
    });
  }

  if (!revalidation.passed) {
    await trackMetric("revalidation_failed", body, { failures:revalidation.failures });
    const expired = {
      ...(lifecycleStore.value || {}),
      dealId,
      status:"EXPIRED",
      lastCheckedAt:nowIso(now),
      expiryReason:revalidation.failures
    };
    await writeLifecycle(lifecycleStore, dealId, expired);

    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"revalidation_failed",
      lifecycle:"EXPIRED",
      revalidation
    });
  }

  const category = normalizeCategory(body.category);
  const antiSpamState = await getAntiSpamState(category, now);
  const antiSpam = evaluateAntiSpam(antiSpamState, body, now);

  if (!antiSpam.passed) {
    const dueAt = computeQueueDueAt(antiSpamState, antiSpam, now);
    const queue = await enqueueDeal(body, dealId, dueAt, "anti_spam");
    await trackMetric("queued", body, { queueReason:antiSpam.failures, scheduledFor:nowIso(dueAt) });

    const queuedLifecycle = {
      ...(lifecycleStore.value || {}),
      dealId,
      status:"QUEUED",
      queuedAt:nowIso(now),
      scheduledFor:nowIso(dueAt),
      queueReason:antiSpam.failures
    };
    await writeLifecycle(lifecycleStore, dealId, queuedLifecycle);

    return res.status(200).json({
      ok:true,
      published:false,
      decision:"queued",
      reason:"anti_spam",
      lifecycle:"QUEUED",
      antiSpam,
      queue
    });
  }

  const fingerprint = buildFingerprint(body);
  const dedupe = await dedupeCheck(fingerprint, now, cooldownSeconds);

  if (dedupe.duplicate) {
    await trackMetric("duplicate_blocked", body);
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"duplicate_cooldown",
      lifecycle:lifecycleStore.value?.status || "VERIFIED",
      deduplication:{ mode:dedupe.mode, cooldownMinutes }
    });
  }

  const host = req.headers.host;
  if (!host) {
    await rollbackDedupe(dedupe, fingerprint);
    return res.status(500).json({ ok:false, error:"host_missing" });
  }

  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const target = `${protocol}://${host}/api/telegram`;

  const publishResponse = await fetch(target, {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "x-affareradar-secret":secret
    },
    body:JSON.stringify(body)
  });

  const publishData = await publishResponse.json().catch(() => ({}));

  if (!publishResponse.ok || !publishData.ok) {
    await rollbackDedupe(dedupe, fingerprint);
    await trackMetric("publish_failed", body);
    return res.status(502).json({
      ok:false,
      published:false,
      error:"telegram_publish_failed",
      telegram:publishData
    });
  }

  await recordAntiSpam(antiSpamState, category, now);

  const lifecycle = nextLifecycle(lifecycleStore.value, body, now);
  await writeLifecycle(lifecycleStore, dealId, lifecycle);
  const distribution = channelPlan(body);
  const storefrontDecision = isReward
    ? {
        candidate:reward.storefrontSupported,
        featured:false,
        storefrontScore:reward.storefrontSupported ? 85 : 0,
        collection:"Abbonamenti Amazon",
        lifecycle:reward.storefrontSupported ? "STOREFRONT_CANDIDATE" : "SKIP",
        reason:reward.storefrontSupported
          ? "Programma Amazon supportato nella vetrina secondo il materiale fornito."
          : "Programma non indicato come supportato nella vetrina dal materiale fornito."
      }
    : evaluateStorefrontCandidate(body, {});
  const storefront = isReward
    ? { ...rewardContent(body, reward), collection:"Abbonamenti Amazon", productUrl:body.amazonUrl || null }
    : storefrontContent(body, storefrontDecision);

  if (redisConfig() && storefrontDecision.candidate) {
    try {
      await redisCommand(
        "SET",
        `affareradar:storefront:candidate:${dealId}`,
        JSON.stringify({ dealId, body, decision:storefrontDecision, content:storefront, updatedAt:nowIso(now) }),
        "EX",
        1209600
      );
      await redisCommand("ZADD", "affareradar:storefront:candidates", String(storefrontDecision.storefrontScore), dealId);
    } catch {}
  }

  await trackMetric("published", body, {
    telegramMessageId:publishData.telegram_message_id,
    lifecycleStatus:lifecycle.status,
    distribution,
    storefrontDecision,
    creatorQuality,
    publishingWindow:window,
    republish,
    reward:isReward ? reward : null,
    repetition,
    trafficSource,
    originality,
    publicationCompliance:publication,
    verification,
    sourceReputation,
    policy,
    opportunity
  });

  try {
    if (redisConfig()) {
      const evidence = evidenceRecord(body, {
        channel:"telegram",
        repetition,
        trafficSource,
        originality,
        publicationCompliance:publishData.publicationCompliance || publication,
        verification,
        sourceReputation,
        policy,
        opportunity,
        telegramMessageId:publishData.telegram_message_id
      });
      await redisCommand("SET", `affareradar:evidence:${evidence.evidenceId}`, JSON.stringify(evidence), "EX", 7776000);
      await redisCommand("LPUSH", "affareradar:evidence:index", evidence.evidenceId);
      await redisCommand("LTRIM", "affareradar:evidence:index", 0, 499);
    }
  } catch {}

  return res.status(200).json({
    ok:true,
    published:true,
    decision:rewardPass ? "amazon_reward_verified" : (scorePass ? "deal_score_threshold" : "high_reliability_special"),
    telegram_message_id:publishData.telegram_message_id,
    badge:publishData.badge,
    lifecycle,
    revalidation,
    antiSpam:{
      mode:antiSpamState.mode,
      critical:antiSpam.critical,
      limits:antiSpam.limits
    },
    deduplication:{
      mode:dedupe.mode,
      cooldownMinutes
    },
    thresholds:{ minDealScore, minReliability },
    distribution,
    storefront:{ decision:storefrontDecision, content:storefront },
    creatorQuality,
    publishingWindow:window,
    republish,
    reward:isReward ? reward : null,
    repetition,
    trafficSource,
    originality,
    publicationCompliance:publishData.publicationCompliance || publication,
    verification,
    sourceReputation,
    policy,
    opportunity
  });
}
