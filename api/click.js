import { verifyTrackedPayload } from "../lib/attribution.js";
import { redisConfig, redisCommand } from "../lib/redis-rest.js";
import { outcomeDimensions } from "../lib/outcome-learning.js";
import { recordOutcomeRegistryEvent } from "../lib/decision-outcome-registry.js";

function safeDestination(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();

    if (
      host === "amazon.it" ||
      host.endsWith(".amazon.it") ||
      host === "amzn.eu" ||
      host === "wa.me" ||
      host === "api.whatsapp.com" ||
      host === "t.me"
    ) {
      return u.toString();
    }
  } catch {}
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  const data = verifyTrackedPayload(req.query?.p, req.query?.s);
  if (!data) {
    return res.status(400).json({ ok:false, error:"invalid_tracking_payload" });
  }

  const destination = safeDestination(data.destination);
  if (!destination) {
    return res.status(400).json({ ok:false, error:"invalid_destination" });
  }

  try {
    if (redisConfig()) {
      const event = {
        event:"attribution_click",
        at:new Date().toISOString(),
        channel:data.channel || "unknown",
        contentType:data.contentType || "unknown",
        action:data.action || "click",
        dealId:data.dealId || null
      };

      const metricKey = `affareradar:attribution:${event.channel}:${event.contentType}:${event.action}`;

      await Promise.all([
        redisCommand("INCR", metricKey),
        redisCommand("INCR", "affareradar:metrics:attribution_click"),
        redisCommand("LPUSH", "affareradar:events", JSON.stringify(event))
      ]);

      await redisCommand("LTRIM", "affareradar:events", 0, 199);

      await recordOutcomeRegistryEvent({
        dealId:event.dealId,
        occurredAt:event.at,
        reportSource:"affareradar_click",
        body:{
          category:data.category || "other",
          source:data.source || "telegram",
          dealType:data.dealType || data.contentType || "deal"
        },
        clicks:event.action === "amazon_click" ? 1 : 0,
        engagements:["telegram_share","whatsapp_share","channel_invite"].includes(event.action) ? 1 : 0
      });

      if (["telegram_share","whatsapp_share","channel_invite"].includes(event.action)) {
        const outcomeContext = {
          category:data.category || "other",
          source:data.source || "telegram",
          dealType:data.dealType || data.contentType || "deal"
        };
        for (const dimension of outcomeDimensions(outcomeContext, Date.now())) {
          const key = `affareradar:outcome:${dimension}`;
          const rr = await redisCommand("GET", key);
          let stats = {
            impressions:0, clicks:0, conversions:0, engagements:0,
            publishes:0, successfulPublishes:0, revenueEUR:0
          };
          if (rr.result) {
            try { stats = { ...stats, ...JSON.parse(rr.result) }; } catch {}
          }
          stats.engagements = Number(stats.engagements || 0) + 1;
          stats.lastUpdatedAt = new Date().toISOString();
          await redisCommand("SET", key, JSON.stringify(stats), "EX", 7776000);
        }
        await redisCommand("INCR", "affareradar:metrics:tracked_engagement");
      }
    }
  } catch {}

  res.setHeader("Cache-Control", "no-store");

  const host = new URL(destination).hostname.toLowerCase();
  const isAmazon = host === "amazon.it" || host.endsWith(".amazon.it") || host === "amzn.eu";

  if (isAmazon) {
    const escaped = destination
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<!doctype html>
<html lang="it">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Continua su Amazon</title></head>
<body style="font-family:system-ui;max-width:680px;margin:48px auto;padding:0 20px;line-height:1.5">
<h1 style="font-size:1.35rem">Continua su Amazon</h1>
<p>Stai per aprire Amazon tramite un link affiliato di AffareRadar.</p>
<p><a href="${escaped}" rel="nofollow sponsored" style="display:inline-block;padding:12px 18px;border:1px solid #222;border-radius:8px;text-decoration:none">Apri Amazon</a></p>
<p style="font-size:.9rem;word-break:break-all">Destinazione: ${escaped}</p>
</body></html>`);
  }

  return res.redirect(302, destination);
}
