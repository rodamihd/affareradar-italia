import { evaluateProductEligibility } from "../lib/amazon-compliance.js";
import { redisConfig, redisCommand } from "../lib/redis-rest.js";

function authorized(req) {
  const secret = process.env.PUBLISH_SECRET;
  return Boolean(secret && req.headers["x-affareradar-secret"] === secret);
}

function preApiEnabled() {
  return String(process.env.AFFARERADAR_PRE_API_MODE || "").trim() === "1";
}

function cleanText(value = "") {
  return String(value || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/(?:EUR|€)\s*\d{1,5}(?:[.,]\d{1,2})?/gi, " ")
    .replace(/\d{1,5}(?:[.,]\d{1,2})?\s*(?:EUR|€)/gi, " ")
    .replace(/(?:-|−)?\s*\d{1,3}\s*%/g, " ")
    .replace(/\b(?:minimo storico|prezzo minimo|price error|errore(?: di)? prezzo|coupon|codice sconto|stack promo|offerta imperdibile|affare pazzesco)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function amazonProductUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    if (!(host === "amazon.it" || host.endsWith(".amazon.it"))) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function asinFromUrl(value) {
  try {
    const u = new URL(value);
    const m = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    return m ? m[1].toUpperCase() : null;
  } catch {
    return null;
  }
}

async function reserveDailySlot(asin) {
  const cfg = redisConfig();
  if (!cfg) return { allowed:false, reason:"redis_required" };

  const maxPerDay = Math.max(1, Math.min(3, Number(process.env.PREAPI_MAX_PER_DAY || 1)));
  const day = new Date().toISOString().slice(0, 10);
  const dayKey = `affareradar:preapi:day:${day}`;
  const asinKey = `affareradar:preapi:asin:${asin}`;

  try {
    const [count, seen] = await Promise.all([
      redisCommand("GET", dayKey),
      redisCommand("GET", asinKey)
    ]);

    if (seen.result) return { allowed:false, reason:"duplicate_asin_24h" };
    if (Number(count.result || 0) >= maxPerDay) return { allowed:false, reason:"daily_limit", maxPerDay };

    const lock = await redisCommand("SET", asinKey, new Date().toISOString(), "NX", "EX", 86400);
    if (lock.result !== "OK") return { allowed:false, reason:"duplicate_asin_24h" };

    const inc = await redisCommand("INCR", dayKey);
    await redisCommand("EXPIRE", dayKey, 172800);
    if (Number(inc.result || 0) > maxPerDay) {
      await redisCommand("DEL", asinKey);
      return { allowed:false, reason:"daily_limit", maxPerDay };
    }

    return { allowed:true, dayKey, asinKey, maxPerDay, count:Number(inc.result || 0) };
  } catch {
    return { allowed:false, reason:"redis_error" };
  }
}

async function rollbackSlot(slot) {
  if (!slot?.asinKey) return;
  try {
    await redisCommand("DEL", slot.asinKey);
    if (slot.dayKey) await redisCommand("DECR", slot.dayKey);
  } catch {}
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }
  if (!authorized(req)) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }
  if (!preApiEnabled()) {
    return res.status(409).json({ ok:false, error:"preapi_mode_disabled" });
  }

  const raw = req.body || {};
  const amazonUrl = amazonProductUrl(raw.amazonUrl);
  const asin = String(raw.asin || asinFromUrl(amazonUrl) || "").trim().toUpperCase();
  const signalScore = Number(raw.dealScore);
  const minSignalScore = Math.max(80, Math.min(100, Number(process.env.PREAPI_MIN_SIGNAL_SCORE || 92)));

  if (!amazonUrl || !/^[A-Z0-9]{10}$/.test(asin)) {
    return res.status(200).json({ ok:true, published:false, decision:"rejected", reason:"amazon_product_identity_required" });
  }
  if (raw.sourceVerified !== true) {
    return res.status(200).json({ ok:true, published:false, decision:"rejected", reason:"source_not_verified" });
  }
  if (!Number.isFinite(signalScore) || signalScore < minSignalScore) {
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"preapi_signal_score_below_threshold",
      threshold:minSignalScore,
      signalScore:Number.isFinite(signalScore) ? signalScore : null
    });
  }

  const title = cleanText(raw.title).slice(0, 140) || `Prodotto Amazon ${asin}`;
  const candidate = {
    title,
    category:cleanText(raw.category).slice(0, 60) || "Amazon",
    reason:"Segnalazione prodotto selezionata da AffareRadar. Prezzo e disponibilità vanno verificati direttamente su Amazon.",
    amazonUrl,
    asin,
    dealType:"preapi_pick",
    source:raw.source || "external_signal",
    sourceVerified:true,
    price:null,
    oldPrice:null,
    effectivePrice:null,
    discount:null,
    coupon:null,
    stack:null,
    historicalLow:false,
    prime:false,
    imageUrl:null,
    imageSource:null,
    imageSuppressed:true,
    suppressPriceDisplay:true,
    preApiMode:true,
    commercialClaimsSuppressed:true,
    signalScore,
    dealScore:null,
    reliabilityScore:null
  };

  const eligibility = evaluateProductEligibility(candidate);
  if (!eligibility.passed) {
    return res.status(200).json({
      ok:true,
      published:false,
      decision:"rejected",
      reason:"product_not_eligible",
      productEligibility:eligibility
    });
  }

  const slot = await reserveDailySlot(asin);
  if (!slot.allowed) {
    return res.status(200).json({ ok:true, published:false, decision:"held", reason:slot.reason, limits:slot });
  }

  const host = req.headers.host;
  const secret = process.env.PUBLISH_SECRET;
  if (!host || !secret) {
    await rollbackSlot(slot);
    return res.status(500).json({ ok:false, error:"host_or_secret_missing" });
  }

  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  try {
    const response = await fetch(`${protocol}://${host}/api/telegram`, {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "x-affareradar-secret":secret
      },
      body:JSON.stringify(candidate)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.ok !== true) {
      await rollbackSlot(slot);
      return res.status(200).json({
        ok:true,
        published:false,
        decision:"failed",
        reason:"telegram_publish_failed",
        status:response.status
      });
    }

    try {
      await redisCommand("SET", "affareradar:preapi:last_publish_at", new Date().toISOString(), "EX", 172800);
      await redisCommand("SET", "affareradar:preapi:last_asin", asin, "EX", 172800);
    } catch {}

    return res.status(200).json({
      ok:true,
      published:true,
      decision:"preapi_published",
      asin,
      telegramMessageId:data.telegram_message_id || null,
      signalScore,
      safeguards:{
        priceSuppressed:true,
        promotionSuppressed:true,
        imageSuppressed:true,
        sourceVerified:true,
        productEligibility:eligibility.status,
        dailyLimit:slot.maxPerDay
      }
    });
  } catch {
    await rollbackSlot(slot);
    return res.status(200).json({ ok:true, published:false, decision:"failed", reason:"preapi_publish_exception" });
  }
}
