import { redisConfig, redisCommand } from "./redis-rest.js";
import { buildQuantoItaliaContent } from "./quantoitalia-content-engine.js";

const CHANNELS = ["instagram","facebook","tiktok","youtube","website","newsletter"];

function enabled(name) {
  const key = `DISTRIBUTION_${String(name).toUpperCase()}_ENABLED`;
  return String(process.env[key] || "").trim() === "1";
}

export function distributionTargets(plan = {}) {
  const channelPlan = plan?.plan || {};
  return CHANNELS.map(channel => ({
    channel,
    enabled:enabled(channel),
    priority:channelPlan[channel]?.priority || "normal",
    format:channelPlan[channel]?.format || null
  }));
}

export async function enqueueQuantoItaliaDistribution(body = {}, plan = {}, options = {}) {
  const dealId = options.dealId || body.asin || String(body.title || "deal").slice(0, 80);
  const content = buildQuantoItaliaContent(body, { dealId });
  const targets = distributionTargets(plan);
  const candidates = targets.filter(t => t.priority !== "future" || t.enabled);

  if (!redisConfig()) {
    return {
      queued:false,
      mode:"no_redis",
      dealId,
      content,
      targets:candidates
    };
  }

  const queued = [];
  for (const target of candidates) {
    const itemId = `${dealId}:${target.channel}`;
    const record = {
      itemId,
      dealId,
      channel:target.channel,
      priority:target.priority,
      format:target.format,
      status:target.enabled ? "READY" : "PREPARED",
      content:content.channels[target.channel],
      canonical:content.canonical,
      createdAt:new Date().toISOString(),
      source:"quantoitalia_distribution_engine_v1"
    };
    await redisCommand("SET", `affareradar:distribution:item:${itemId}`, JSON.stringify(record), "EX", 1209600);
    await redisCommand("ZADD", "affareradar:distribution:queue", String(Date.now()), itemId);
    queued.push({ itemId, channel:target.channel, status:record.status, priority:record.priority });
  }

  await redisCommand("INCR", "affareradar:metrics:distribution_packages_created");
  return {
    queued:true,
    mode:"persistent_upstash_redis",
    dealId,
    queuedItems:queued,
    contentVersion:content.version
  };
}
