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
    const storefrontIdsResult = await redisCommand("ZREVRANGE", "affareradar:storefront:candidates", 0, 7, "WITHSCORES");
    const storefrontPairs = Array.isArray(storefrontIdsResult.result) ? storefrontIdsResult.result : [];
    const storefrontCandidates = [];
    for (let i = 0; i < storefrontPairs.length; i += 2) {
      const dealId = storefrontPairs[i];
      const score = Number(storefrontPairs[i + 1] || 0);
      const rr = await redisCommand("GET", `affareradar:storefront:candidate:${dealId}`);
      if (!rr.result) continue;
      try {
        const item = JSON.parse(rr.result);
        storefrontCandidates.push({ ...item, score });
      } catch {}
    }

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
      "publish_failed",
      "attribution_click"
    ];

    const metricResults = await Promise.all(
      metricNames.map(name => redisCommand("GET", `affareradar:metrics:${name}`))
    );

    const metrics = {};
    metricNames.forEach((name, i) => {
      metrics[name] = Number(metricResults[i].result || 0);
    });

    const [
      queueCountResult,
      eventsResult,
      queueIdsResult,
      lastDiscoveryAtResult,
      lastDiscoveryCountResult,
      multisourceLastRunResult,
      multisourceCandidateCountResult,
      multisourceSourceCountResult
    ] = await Promise.all([
      redisCommand("ZCARD", "affareradar:queue"),
      redisCommand("LRANGE", "affareradar:events", 0, 49),
      redisCommand("ZRANGE", "affareradar:queue", 0, 19, "WITHSCORES"),
      redisCommand("GET", "affareradar:amazon:last_discovery_at"),
      redisCommand("GET", "affareradar:amazon:last_discovery_count"),
      redisCommand("GET", "affareradar:multisource:last_run_at"),
      redisCommand("GET", "affareradar:multisource:last_candidate_count"),
      redisCommand("GET", "affareradar:multisource:last_source_count")
    ]);

    const events = Array.isArray(eventsResult.result)
      ? eventsResult.result.map(item => {
          try { return JSON.parse(item); } catch { return { event:"unknown", raw:item }; }
        })
      : [];

    const queuePairs = Array.isArray(queueIdsResult.result) ? queueIdsResult.result : [];
    const queue = [];
    for (let i = 0; i < queuePairs.length; i += 2) {
      const dealId = queuePairs[i];
      const score = Number(queuePairs[i + 1] || 0);
      const itemResult = await redisCommand("GET", `affareradar:queue:item:${dealId}`);
      let item = null;
      try { item = itemResult.result ? JSON.parse(itemResult.result) : null; } catch {}
      queue.push({
        dealId,
        scheduledFor:score ? new Date(score).toISOString() : null,
        reason:item?.reason || null,
        attempts:Number(item?.attempts || 0),
        body:item?.body || null
      });
    }

    const lifecycle = [];
    const seen = new Set();
    for (const e of events) {
      if (!e.dealId || seen.has(e.dealId)) continue;
      seen.add(e.dealId);
      const lr = await redisCommand("GET", `affareradar:lifecycle:${e.dealId}`);
      if (lr.result) {
        try { lifecycle.push(JSON.parse(lr.result)); } catch {}
      }
      if (lifecycle.length >= 20) break;
    }

    const attributionContentTypes = ["deal","top_deal","price_error","coupon_stack","historical_low"];
    const attributionActions = ["amazon_click","telegram_share","whatsapp_share","channel_invite"];
    const attribution = {};

    for (const contentType of attributionContentTypes) {
      attribution[contentType] = {};
      for (const action of attributionActions) {
        const rr = await redisCommand("GET", `affareradar:attribution:telegram:${contentType}:${action}`);
        attribution[contentType][action] = Number(rr.result || 0);
      }
    }

    const modules = {
      telegram:Boolean(telegramHealth?.targetReachable && telegramHealth?.botCanPost),
      redis:true,
      queueProcessor:true,
      revalidation:true,
      deduplication:true,
      antiSpam:true,
      lifecycle:true,
      amazonDiscovery:Boolean(process.env.AMAZON_CREATORS_CREDENTIAL_ID && process.env.AMAZON_CREATORS_CREDENTIAL_SECRET && process.env.AMAZON_PARTNER_TAG),
      multiSourceDiscovery:true,
      affiliateTracking:Boolean(process.env.AMAZON_PARTNER_TAG),
      deepLinkEngine:Boolean(process.env.DEEPLINK_URL_TEMPLATE),
      channelStrategy:true,
      contentRepurposing:true,
      storefrontIntelligence:true
    };

    return res.status(200).json({
      ok:true,
      redisConfigured:true,
      metrics,
      queueCount:Number(queueCountResult.result || 0),
      queue,
      lifecycle,
      modules,
      amazonDiscovery:{
        configured:modules.amazonDiscovery,
        lastRunAt:lastDiscoveryAtResult.result || null,
        lastCandidateCount:lastDiscoveryCountResult.result ? Number(lastDiscoveryCountResult.result) : null
      },
      multiSourceDiscovery:{
        configured:true,
        lastRunAt:multisourceLastRunResult.result || null,
        lastCandidateCount:multisourceCandidateCountResult.result ? Number(multisourceCandidateCountResult.result) : null,
        lastSourceCount:multisourceSourceCountResult.result ? Number(multisourceSourceCountResult.result) : null
      },
      storefrontCandidates,
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
