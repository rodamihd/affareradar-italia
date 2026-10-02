function clamp(v, min = 0, max = 100) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function sourceKey(body = {}) {
  return String(body.source || body.signalSource || "unknown").trim().toLowerCase() || "unknown";
}

export function initialSourceReputation(body = {}) {
  const source = sourceKey(body);
  if (source === "amazon_creators_api" || source === "amazon_pa_api") return { source, score:98, status:"TRUSTED_AMAZON" };
  if (source === "manual_owned") return { source, score:90, status:"TRUSTED_OWNED" };
  return { source, score:60, status:"LEARNING" };
}

export function computeSourceReputation(stats = {}, body = {}) {
  const base = initialSourceReputation(body);
  const total = Number(stats.total || 0);
  const confirmed = Number(stats.confirmed || 0);
  const rejected = Number(stats.rejected || 0);
  if (total <= 0) return { ...base, samples:0 };

  const hitRate = clamp((confirmed / total) * 100);
  const rejectionPenalty = clamp((rejected / total) * 100);
  const score = clamp(base.score * 0.35 + hitRate * 0.75 - rejectionPenalty * 0.25);

  return {
    source:base.source,
    score:Number(score.toFixed(1)),
    samples:total,
    confirmed,
    rejected,
    hitRate:Number(hitRate.toFixed(1)),
    status:score >= 80 ? "TRUSTED" : score >= 55 ? "LEARNING" : "DEGRADED"
  };
}
