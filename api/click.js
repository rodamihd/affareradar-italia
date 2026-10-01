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
  return res.redirect(302, destination);
}
