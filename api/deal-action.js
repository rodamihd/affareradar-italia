import { executeExternalOperation } from "../lib/agentos-external-runtime.js";

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

function authorized(req) {
  const secret = process.env.PUBLISH_SECRET;
  return Boolean(secret && req.headers["x-affareradar-secret"] === secret);
}

function nowIso() {
  return new Date().toISOString();
}

async function logEvent(event, item, extra = {}) {
  if (!redisConfig()) return;
  const body = item?.body || {};
  const payload = {
    event,
    at:nowIso(),
    dealId:item?.dealId || body.asin || null,
    asin:body.asin || null,
    title:body.title || null,
    category:body.category || null,
    dealType:body.dealType || null,
    dealScore:Number.isFinite(Number(body.dealScore)) ? Number(body.dealScore) : null,
    ...extra
  };
  try {
    await Promise.all([
      redisCommand("INCR", `affareradar:metrics:${event}`),
      redisCommand("LPUSH", "affareradar:events", JSON.stringify(payload))
    ]);
    await redisCommand("LTRIM", "affareradar:events", 0, 199);
  } catch {}
}

async function updateLifecycle(dealId, patch) {
  if (!redisConfig()) return;
  const key = `affareradar:lifecycle:${dealId}`;
  let current = {};
  try {
    const existing = await redisCommand("GET", key);
    if (existing.result) current = JSON.parse(existing.result);
  } catch {}
  const next = { ...current, dealId, ...patch };
  await redisCommand("SET", key, JSON.stringify(next), "EX", 604800);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  if (!authorized(req)) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  if (req.body?.action === "agentos.external") {
    const result = executeExternalOperation(req.body?.request || {});
    return res.status(result.status || 200).json(result);
  }

  if (!redisConfig()) {
    return res.status(503).json({ ok:false, error:"redis_not_configured" });
  }

  const { action, dealId } = req.body || {};
  if (!action || !dealId) {
    return res.status(400).json({ ok:false, error:"missing_action_or_deal_id" });
  }

  const queueKey = "affareradar:queue";
  const itemKey = `affareradar:queue:item:${dealId}`;
  const itemResult = await redisCommand("GET", itemKey);

  if (!itemResult.result) {
    return res.status(404).json({ ok:false, error:"queue_item_not_found" });
  }

  let item;
  try {
    item = JSON.parse(itemResult.result);
  } catch {
    return res.status(500).json({ ok:false, error:"invalid_queue_payload" });
  }

  const host = req.headers.host;
  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const secret = process.env.PUBLISH_SECRET;

  if (action === "discard") {
    await Promise.all([
      redisCommand("ZREM", queueKey, dealId),
      redisCommand("DEL", itemKey)
    ]);
    await updateLifecycle(dealId, {
      status:"REJECTED",
      rejectedAt:nowIso(),
      rejectionReason:"manual_mission_control"
    });
    await logEvent("manual_discarded", item);
    return res.status(200).json({ ok:true, action, dealId, status:"REJECTED" });
  }

  if (!host || !secret) {
    return res.status(500).json({ ok:false, error:"publisher_not_configured" });
  }

  if (action === "retry") {
    await Promise.all([
      redisCommand("ZREM", queueKey, dealId),
      redisCommand("DEL", itemKey)
    ]);

    const target = `${protocol}://${host}/api/auto-publish`;
    const r = await fetch(target, {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "x-affareradar-secret":secret
      },
      body:JSON.stringify({
        ...(item.body || {}),
        __fromMissionControl:true,
        __queueAttempts:Number(item.attempts || 0) + 1
      })
    });
    const data = await r.json().catch(() => ({}));

    await logEvent("manual_retry", item, {
      published:Boolean(data.published),
      decision:data.decision || null,
      reason:data.reason || null
    });

    return res.status(r.ok ? 200 : 502).json({
      ok:r.ok,
      action,
      dealId,
      result:data
    });
  }

  if (action === "publish_now") {
    const target = `${protocol}://${host}/api/telegram`;
    const r = await fetch(target, {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "x-affareradar-secret":secret
      },
      body:JSON.stringify(item.body || {})
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok || !data.ok) {
      await logEvent("manual_publish_failed", item);
      return res.status(502).json({
        ok:false,
        action,
        dealId,
        error:"telegram_publish_failed",
        telegram:data
      });
    }

    await Promise.all([
      redisCommand("ZREM", queueKey, dealId),
      redisCommand("DEL", itemKey)
    ]);

    await updateLifecycle(dealId, {
      status:"PUBLISHED",
      lastPublishedAt:nowIso(),
      manualOverride:true,
      telegramMessageId:data.telegram_message_id || null
    });
    await logEvent("manual_published", item, {
      telegramMessageId:data.telegram_message_id || null
    });

    return res.status(200).json({
      ok:true,
      action,
      dealId,
      telegram_message_id:data.telegram_message_id || null,
      target:data.target || null
    });
  }

  return res.status(400).json({ ok:false, error:"unsupported_action" });
}
