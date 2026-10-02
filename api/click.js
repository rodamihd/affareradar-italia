import { verifyTrackedPayload } from "../lib/attribution.js";

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
