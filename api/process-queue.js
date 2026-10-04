function redisConfig() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.UPSTASH_REDIS_REST_URL_KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.UPSTASH_REDIS_REST_URL_KV_REST_API_TOKEN;
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
  const bearer = req.headers.authorization;
  const publisher = req.headers["x-affareradar-secret"];

  return Boolean(
    (cronSecret && bearer === `Bearer ${cronSecret}`) ||
    (publishSecret && publisher === publishSecret)
  );
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"method_not_allowed" });
  }

  if (!authorized(req)) {
    return res.status(401).json({ ok:false, error:"unauthorized" });
  }

  if (!redisConfig()) {
    return res.status(503).json({
      ok:false,
      error:"persistent_queue_unavailable",
      reason:"upstash_redis_not_configured"
    });
  }

  const secret = process.env.PUBLISH_SECRET;
  if (!secret) {
    return res.status(500).json({ ok:false, error:"publish_secret_missing" });
  }

  const host = req.headers.host;
  if (!host) {
    return res.status(500).json({ ok:false, error:"host_missing" });
  }

  const now = Date.now();
  const batchSize = Math.max(1, Math.min(10, Number(process.env.QUEUE_BATCH_SIZE || 3)));
  const maxAttempts = Math.max(1, Number(process.env.QUEUE_MAX_ATTEMPTS || 5));
  const queueKey = "affareradar:queue";

  let due;
  try {
    due = await redisCommand("ZRANGEBYSCORE", queueKey, "-inf", String(now), "LIMIT", 0, batchSize);
  } catch (error) {
    return res.status(502).json({
      ok:false,
      error:"queue_read_failed",
      detail:String(error?.message || error)
    });
  }

  const dealIds = Array.isArray(due.result) ? due.result : [];
  const protocol = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const target = `${protocol}://${host}/api/auto-publish`;
  const results = [];

  for (const dealId of dealIds) {
    const itemKey = `affareradar:queue:item:${dealId}`;

    try {
      const itemResult = await redisCommand("GET", itemKey);
      if (!itemResult.result) {
        await redisCommand("ZREM", queueKey, dealId);
        results.push({ dealId, status:"removed_missing_payload" });
        continue;
      }

      const item = JSON.parse(itemResult.result);
      const attempts = Number(item.attempts || 0) + 1;

      if (attempts > maxAttempts) {
        await Promise.all([
          redisCommand("ZREM", queueKey, dealId),
          redisCommand("DEL", itemKey)
        ]);
        results.push({ dealId, status:"discarded_max_attempts", attempts });
        continue;
      }

      await Promise.all([
        redisCommand("ZREM", queueKey, dealId),
        redisCommand("DEL", itemKey)
      ]);

      const body = {
        ...(item.body || {}),
        __queueAttempts:attempts,
        __fromQueue:true
      };

      const r = await fetch(target, {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "x-affareradar-secret":secret
        },
        body:JSON.stringify(body)
      });

      const data = await r.json().catch(() => ({}));

      results.push({
        dealId,
        attempts,
        status:data.published ? "published" : (data.decision || "not_published"),
        reason:data.reason || null,
        telegram_message_id:data.telegram_message_id || null
      });
    } catch (error) {
      results.push({
        dealId,
        status:"processing_error",
        error:String(error?.message || error)
      });
    }
  }

  return res.status(200).json({
    ok:true,
    processed:dealIds.length,
    batchSize,
    maxAttempts,
    results
  });
}
