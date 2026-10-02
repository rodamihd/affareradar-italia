function clamp(v, min = 0, max = 100) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function slug(value = "unknown") {
  return String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "unknown";
}

function halfLifeDays() {
  const n = Number(process.env.SOURCE_REPUTATION_HALF_LIFE_DAYS || 14);
  return Number.isFinite(n) && n > 0 ? n : 14;
}

export function sourceKey(body = {}) {
  return String(body.source || body.signalSource || "unknown").trim().toLowerCase() || "unknown";
}

export function sourceReputationKeys(body = {}) {
  const source = slug(sourceKey(body));
  const category = slug(body.category || "other");
  const dealType = slug(body.dealType || body.rewardProgram || "deal");
  return [
    { dimension:"source", suffix:source, weight:0.55 },
    { dimension:"category", suffix:`${source}:category:${category}`, weight:0.25 },
    { dimension:"dealType", suffix:`${source}:dealtype:${dealType}`, weight:0.20 }
  ];
}

export function initialSourceReputation(body = {}) {
  const source = sourceKey(body);
  if (source === "amazon_creators_api" || source === "amazon_pa_api") {
    return { source, score:98, status:"TRUSTED_AMAZON", version:"2.0" };
  }
  if (source === "manual_owned") {
    return { source, score:90, status:"TRUSTED_OWNED", version:"2.0" };
  }
  return { source, score:60, status:"LEARNING", version:"2.0" };
}

export function decaySourceStats(stats = {}, now = Date.now()) {
  const updatedAt = Date.parse(stats.lastUpdatedAt || "");
  if (!Number.isFinite(updatedAt)) return { ...stats };
  const ageDays = Math.max(0, (now - updatedAt) / 86400000);
  const decay = Math.pow(0.5, ageDays / halfLifeDays());
  const next = { ...stats };
  for (const key of ["total","confirmed","rejected","published","verificationRequired","falsePositive"]) {
    next[key] = Number(stats[key] || 0) * decay;
  }
  return next;
}

export function applySourceOutcome(stats = {}, outcome = {}, now = Date.now()) {
  const decayed = decaySourceStats(stats, now);
  const next = {
    total:Number(decayed.total || 0) + Number(outcome.total || 0),
    confirmed:Number(decayed.confirmed || 0) + Number(outcome.confirmed || 0),
    rejected:Number(decayed.rejected || 0) + Number(outcome.rejected || 0),
    published:Number(decayed.published || 0) + Number(outcome.published || 0),
    verificationRequired:Number(decayed.verificationRequired || 0) + Number(outcome.verificationRequired || 0),
    falsePositive:Number(decayed.falsePositive || 0) + Number(outcome.falsePositive || 0),
    lastProvider:outcome.provider || stats.lastProvider || null,
    lastOutcome:outcome.label || stats.lastOutcome || null,
    lastUpdatedAt:new Date(now).toISOString()
  };
  return next;
}

function dimensionScore(stats = {}, body = {}, now = Date.now()) {
  const base = initialSourceReputation(body);
  const s = decaySourceStats(stats, now);
  const total = Math.max(0, Number(s.total || 0));
  if (total <= 0) {
    return { score:base.score, samples:0, hitRate:null, rejectionRate:null, falsePositiveRate:null };
  }

  const confirmed = Math.max(0, Number(s.confirmed || 0));
  const rejected = Math.max(0, Number(s.rejected || 0));
  const falsePositive = Math.max(0, Number(s.falsePositive || 0));
  const published = Math.max(0, Number(s.published || 0));
  const hitRate = clamp((confirmed / total) * 100);
  const rejectionRate = clamp((rejected / total) * 100);
  const falsePositiveRate = clamp((falsePositive / total) * 100);
  const publishRate = clamp((published / total) * 100);

  const evidenceScore = clamp(
    hitRate * 0.88 +
    publishRate * 0.07 -
    rejectionRate * 0.28 -
    falsePositiveRate * 0.42
  );
  const evidenceWeight = Math.min(1, total / 20);
  const score = clamp(base.score * (1 - evidenceWeight) + evidenceScore * evidenceWeight);

  return {
    score:Number(score.toFixed(1)),
    samples:Number(total.toFixed(2)),
    confirmed:Number(confirmed.toFixed(2)),
    rejected:Number(rejected.toFixed(2)),
    falsePositive:Number(falsePositive.toFixed(2)),
    hitRate:Number(hitRate.toFixed(1)),
    rejectionRate:Number(rejectionRate.toFixed(1)),
    falsePositiveRate:Number(falsePositiveRate.toFixed(1))
  };
}

export function computeSourceReputation(statsInput = {}, body = {}, now = Date.now()) {
  const base = initialSourceReputation(body);
  const dimensions = sourceReputationKeys(body);

  if (!Array.isArray(statsInput)) {
    const d = dimensionScore(statsInput, body, now);
    return {
      ...base,
      score:d.score,
      samples:d.samples,
      confirmed:d.confirmed || 0,
      rejected:d.rejected || 0,
      falsePositive:d.falsePositive || 0,
      hitRate:d.hitRate,
      status:d.score >= 82 ? "TRUSTED" : d.score >= 55 ? "LEARNING" : "DEGRADED",
      dimensions:{ source:d }
    };
  }

  let weighted = 0;
  let weightSum = 0;
  const detail = {};
  for (const dimension of dimensions) {
    const row = statsInput.find(x => x?.dimension === dimension.dimension);
    const scored = dimensionScore(row?.stats || {}, body, now);
    detail[dimension.dimension] = scored;
    const effectiveWeight = scored.samples > 0 ? dimension.weight : 0;
    weighted += scored.score * effectiveWeight;
    weightSum += effectiveWeight;
  }

  const score = weightSum > 0 ? weighted / weightSum : base.score;
  const samples = Object.values(detail).reduce((sum, d) => sum + Number(d.samples || 0), 0);
  return {
    ...base,
    score:Number(score.toFixed(1)),
    samples:Number(samples.toFixed(2)),
    status:score >= 82 ? "TRUSTED" : score >= 55 ? "LEARNING" : "DEGRADED",
    halfLifeDays:halfLifeDays(),
    dimensions:detail
  };
}
