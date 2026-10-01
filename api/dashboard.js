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

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  if (!authorized(req)) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  const cfg = redisConfig();

  let telegramHealth = null;
  try {
    const host = req.headers.host;
    if (host) {
      const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
      const healthRes = await fetch(`${protocol}://${host}/api/health`);
      telegramHealth = await healthRes.json().catch(() => null);
    }
  } catch {}

  if (!cfg) {
    return res.status(200).json({
      ok:true,
      redisConfigured:false,
      metrics:{},
      queueCount:null,
      events:[],
      telegramHealth
    });
  }

  try {
    const metricNames = [
      "published",
      "queued",
      "revalidation_failed",
      "duplicate_blocked",
      "rejected_below_threshold",
      "publish_failed"
    ];

    const metricResults = await Promise.all(
      metricNames.map(name => redisCommand("GET", `affareradar:metrics:${name}`))
    );

    const metrics = {};
    metricNames.forEach((name, i) => {
      metrics[name] = Number(metricResults[i].result || 0);
    });

    const [queueCountResult, eventsResult] = await Promise.all([
      redisCommand("ZCARD", "affareradar:queue"),
      redisCommand("LRANGE", "affareradar:events", 0, 49)
    ]);

    const events = Array.isArray(eventsResult.result)
      ? eventsResult.result.map(item => {
          try { return JSON.parse(item); } catch { return { event:"unknown", raw:item }; }
        })
      : [];

    return res.status(200).json({
      ok:true,
      redisConfigured:true,
      metrics,
      queueCount:Number(queueCountResult.result || 0),
      events,
      telegramHealth
    });
  } catch (error) {
    return res.status(502).json({
      ok:false,
      error:"dashboard_read_failed",
      detail:String(error?.message || error)
    });
  }
}
