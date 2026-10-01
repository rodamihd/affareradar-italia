import crypto from "node:crypto";

const recentPublishes = globalThis.__affareRadarRecentPublishes || new Map();
globalThis.__affareRadarRecentPublishes = recentPublishes;

function buildFingerprint(body) {
  const asin = String(body.asin || "").trim().toUpperCase();
  const price = String(body.effectivePrice || body.price || "").trim();
  const coupon = String(body.coupon || "").trim();
  const stack = String(body.stack || "").trim();
  const type = String(body.dealType || "").trim().toLowerCase();
  return [asin || String(body.amazonUrl || "").trim(), price, coupon, stack, type].join("|");
}

function fingerprintKey(fingerprint) {
  return "affareradar:published:" + crypto.createHash("sha256").update(fingerprint, "utf8").digest("hex");
}

function cleanupOldEntries(now, maxAgeMs) {
  for (const [key, ts] of recentPublishes.entries()) {
    if (now - ts > maxAgeMs) recentPublishes.delete(key);
  }
}

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url:url.replace(/\/$/, ""), token } : null;
}

async function redisGet(key) {
  const cfg = redisConfig();
  if (!cfg) return { configured:false, value:null };
  const r = await fetch(`${cfg.url}/get/${encodeURIComponent(key)}`, {
    headers:{ Authorization:`Bearer ${cfg.token}` }
  });
  if (!r.ok) throw new Error(`redis_get_${r.status}`);
  const data = await r.json();
  return { configured:true, value:data.result ?? null };
}

async function redisSetNx(key, value, ttlSeconds) {
  const cfg = redisConfig();
  if (!cfg) return { configured:false, stored:false };
  const r = await fetch(
    `${cfg.url}/set/${encodeURIComponent(key)}/${encodeURIComponent(String(value))}?NX=true&EX=${Math.max(1, Math.floor(ttlSeconds))}`,
    { headers:{ Authorization:`Bearer ${cfg.token}` } }
  );
  if (!r.ok) throw new Error(`redis_set_${r.status}`);
  const data = await r.json();
  return { configured:true, stored:data.result === "OK" };
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

  const body = req.body || {};
  const dealScore = Number(body.dealScore);
  const reliabilityScore = Number(body.reliabilityScore);
  const dealType = String(body.dealType || "").toLowerCase();
  const stock = body.stock;

  const minDealScore = Number(process.env.AUTO_PUBLISH_MIN_DEAL_SCORE || 90);
  const minReliability = Number(process.env.AUTO_PUBLISH_MIN_RELIABILITY || 85);
  const cooldownMinutes = Number(process.env.AUTO_PUBLISH_COOLDOWN_MINUTES || 180);
  const cooldownMs = Math.max(1, cooldownMinutes) * 60 * 1000;
  const cooldownSeconds = Math.max(60, Math.floor(cooldownMs / 1000));

  const scorePass = Number.isFinite(dealScore) && dealScore >= minDealScore;
  const specialType = dealType === "price_error" || dealType === "coupon_stack";
  const reliabilityPass = specialType && Number.isFinite(reliabilityScore) && reliabilityScore >= minReliability;

  const outOfStock = stock === false || String(stock).toLowerCase() === "out_of_stock";
  if (outOfStock) {
    return res.status(200).json({ ok:true, published:false, decision:"rejected", reason:"out_of_stock" });
  }

  if (!scorePass && !reliabilityPass) {
    return res.status(200).json({
      ok:true, published:false, decision:"rejected", reason:"below_threshold",
      thresholds:{ minDealScore, minReliability },
      received:{
        dealScore:Number.isFinite(dealScore) ? dealScore : null,
        reliabilityScore:Number.isFinite(reliabilityScore) ? reliabilityScore : null,
        dealType:dealType || null
      }
    });
  }

  const now = Date.now();
  cleanupOldEntries(now, cooldownMs * 2);

  const fingerprint = buildFingerprint(body);
  const key = fingerprintKey(fingerprint);
  let dedupeMode = "best_effort_in_memory";
  let persistentUnavailableReason = null;

  try {
    const remote = await redisGet(key);
    if (remote.configured) {
      dedupeMode = "persistent_upstash_redis";
      if (remote.value) {
        return res.status(200).json({
          ok:true, published:false, decision:"rejected", reason:"duplicate_cooldown",
          cooldownMinutes, retryAfterSeconds:null, fingerprint, deduplication:{ mode:dedupeMode }
        });
      }
    }
  } catch (error) {
    persistentUnavailableReason = String(error?.message || error);
  }

  const lastPublishedAt = recentPublishes.get(fingerprint);
  if (lastPublishedAt && now - lastPublishedAt < cooldownMs) {
    return res.status(200).json({
      ok:true, published:false, decision:"rejected", reason:"duplicate_cooldown",
      cooldownMinutes,
      retryAfterSeconds:Math.ceil((cooldownMs - (now - lastPublishedAt)) / 1000),
      fingerprint,
      deduplication:{ mode:dedupeMode, persistentUnavailableReason }
    });
  }

  if (dedupeMode === "persistent_upstash_redis") {
    try {
      const lock = await redisSetNx(key, now, cooldownSeconds);
      if (lock.configured && !lock.stored) {
        return res.status(200).json({
          ok:true, published:false, decision:"rejected", reason:"duplicate_cooldown",
          cooldownMinutes, retryAfterSeconds:null, fingerprint, deduplication:{ mode:dedupeMode }
        });
      }
    } catch (error) {
      dedupeMode = "best_effort_in_memory";
      persistentUnavailableReason = String(error?.message || error);
    }
  }

  const host = req.headers.host;
  if (!host) return res.status(500).json({ ok:false, error:"host_missing" });

  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const target = `${protocol}://${host}/api/telegram`;

  const publishResponse = await fetch(target, {
    method:"POST",
    headers:{ "Content-Type":"application/json", "x-affareradar-secret":secret },
    body:JSON.stringify(body)
  });
  const publishData = await publishResponse.json().catch(() => ({}));

  if (!publishResponse.ok || !publishData.ok) {
    return res.status(502).json({
      ok:false, published:false, error:"telegram_publish_failed", telegram:publishData,
      deduplication:{ mode:dedupeMode, persistentUnavailableReason }
    });
  }

  recentPublishes.set(fingerprint, now);

  return res.status(200).json({
    ok:true, published:true,
    decision:scorePass ? "deal_score_threshold" : "high_reliability_special",
    telegram_message_id:publishData.telegram_message_id,
    badge:publishData.badge,
    deduplication:{
      fingerprint, cooldownMinutes, mode:dedupeMode, persistentUnavailableReason
    },
    thresholds:{ minDealScore, minReliability }
  });
}
