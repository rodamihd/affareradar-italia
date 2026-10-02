import { optimizePortfolio } from "../lib/portfolio-optimizer.js";
import { buildOfferLifecycle } from "../lib/offer-lifecycle.js";
import { agentOsEvent } from "../lib/agentos-adapter.js";
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
  const cronSecret = process.env.CRON_SECRET;
  const publishSecret = process.env.PUBLISH_SECRET;
  return Boolean(
    (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) ||
    (publishSecret && req.headers["x-affareradar-secret"] === publishSecret)
  );
}

function esc(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

function rank(events) {
  const seen = new Set();
  const candidates = events
    .filter(e => e && (e.event === "published" || e.event === "manual_published"))
    .filter(e => {
      const key = e.asin || e.dealId || e.amazonUrl || e.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(e => ({
      ...e,
      reward:e.reward || (e.dealType === "reward" ? { isReward:true } : null)
    }));

  return optimizePortfolio(candidates, {
    maxItems:5,
    maxPerCategory:2,
    maxRewards:1
  }).selected;
}

async function refreshPublishedLifecycles(events) {
  const seen = new Set();
  let changed = 0;

  for (const event of events.slice(0, 100)) {
    const dealId = event?.dealId;
    if (!dealId || seen.has(dealId)) continue;
    seen.add(dealId);

    const rr = await redisCommand("GET", `affareradar:lifecycle:${dealId}`);
    if (!rr.result) continue;

    let previous;
    try { previous = JSON.parse(rr.result); } catch { continue; }

    const next = buildOfferLifecycle(event, previous, Date.now());
    const nextStatus = next.status;
    const previousStatus = previous.agentLifecycle || previous.status || null;

    if (nextStatus !== previousStatus && ["STALE","EXPIRED"].includes(nextStatus)) {
      const updated = { ...previous, ...next, agentLifecycle:nextStatus };
      await redisCommand("SET", `affareradar:lifecycle:${dealId}`, JSON.stringify(updated), "EX", 604800);
      const agentEvent = agentOsEvent(
        nextStatus === "EXPIRED" ? "AFFARERADAR_OFFER_EXPIRED" : "AFFARERADAR_OFFER_STALE",
        event,
        {
          lifecycle:nextStatus,
          knowledgeStatus:nextStatus,
          payload:{ dealId, previousStatus, nextStatus }
        }
      );
      await redisCommand("LPUSH", "affareradar:agentos:events", JSON.stringify(agentEvent));
      changed += 1;
    }
  }

  if (changed) await redisCommand("LTRIM", "affareradar:agentos:events", 0, 499);
  return changed;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  if (!authorized(req)) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  if (!redisConfig()) {
    return res.status(503).json({ ok:false, error:"redis_not_configured" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID || process.env.TELEGRAM_CHANNEL_USERNAME;
  if (!token || !channelId) {
    return res.status(500).json({ ok:false, error:"telegram_channel_not_configured" });
  }

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const ev = await redisCommand("LRANGE", "affareradar:events", 0, 199);
  const events = Array.isArray(ev.result)
    ? ev.result.map(x => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean)
    : [];

  const recent = events.filter(e => {
    const ts = Date.parse(e.at || "");
    return Number.isFinite(ts) && ts >= since;
  });

  const lifecycleChanges = await refreshPublishedLifecycles(events);
  const picks = rank(recent);
  if (!picks.length) {
    return res.status(200).json({ ok:true, published:false, reason:"no_published_deals_last_24h" });
  }

  const lines = [
    "<b>🏆 TOP 5 AFFARERADAR — ultime 24 ore</b>",
    "",
    ...picks.flatMap((e,i) => {
      const price = e.effectivePrice || e.price || "";
      return [
        `<b>${i+1}. ${esc(e.title || e.asin || e.dealId || "Offerta")}</b>`,
        price ? `💶 ${esc(price)}` : null,
        Number.isFinite(Number(e.dealScore)) ? `🎯 Deal Score: <b>${Number(e.dealScore)}/100</b>` : null,
        e.discount ? `📉 ${esc(e.discount)}` : null,
        e.amazonUrl ? `🔗 <a href="${esc(e.amazonUrl)}">Vedi offerta</a>` : null,
        ""
      ].filter(Boolean);
    }),
    "👍 Utile   🔥 Affare forte   ❌ Non più valido",
    "",
    "🔗 I link Amazon possono essere affiliati."
  ];

  const apiBase = `https://api.telegram.org/bot${token}`;
  const r = await fetch(`${apiBase}/sendMessage`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({
      chat_id:channelId,
      text:lines.join("\n"),
      parse_mode:"HTML",
      disable_web_page_preview:true
    })
  });

  const data = await r.json();
  if (!r.ok || !data.ok) {
    return res.status(502).json({ ok:false, error:"telegram_top5_failed", telegram:data });
  }

  try {
    await Promise.all([
      redisCommand("INCR", "affareradar:metrics:daily_top5"),
      redisCommand("LPUSH", "affareradar:events", JSON.stringify({
        event:"daily_top5",
        at:new Date().toISOString(),
        count:picks.length,
        telegramMessageId:data.result?.message_id || null
      }))
    ]);
    await redisCommand("LTRIM", "affareradar:events", 0, 199);
  } catch {}

  return res.status(200).json({
    ok:true,
    published:true,
    count:picks.length,
    lifecycleChanges,
    telegram_message_id:data.result?.message_id || null
  });
}
