function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pct(a, b) {
  return b > 0 ? (a / b) * 100 : 0;
}

function safeKey(v, fallback = "unknown") {
  return String(v || fallback).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
}

export function audienceCellScore(stats = {}) {
  const impressions = num(stats.impressions);
  const clicks = num(stats.clicks);
  const leads = num(stats.leads);
  const activations = num(stats.activations);
  const verifiedRevenueEUR = num(stats.verifiedRevenueEUR);

  const ctr = pct(clicks, impressions);
  const clickToLead = pct(leads, clicks);
  const leadToActivation = pct(activations, leads);
  const rpm = impressions > 0 ? (verifiedRevenueEUR / impressions) * 1000 : 0;

  const score = Math.min(100,
    Math.min(25, ctr * 2.5) +
    Math.min(25, clickToLead * 1.25) +
    Math.min(25, leadToActivation * 1.25) +
    Math.min(25, rpm / 2)
  );

  return {
    score:Number(score.toFixed(2)),
    ctr:Number(ctr.toFixed(2)),
    clickToLead:Number(clickToLead.toFixed(2)),
    leadToActivation:Number(leadToActivation.toFixed(2)),
    revenuePer1000Impressions:Number(rpm.toFixed(2)),
    confidence:
      impressions >= 1000 ? "HIGH" :
      impressions >= 200 ? "MEDIUM" :
      impressions >= 50 ? "LOW" : "INSUFFICIENT"
  };
}

export function buildAudienceMatrix(rows = []) {
  const matrix = {};

  for (const row of Array.isArray(rows) ? rows : []) {
    const category = safeKey(row.category);
    const channel = safeKey(row.channel);
    matrix[category] ||= {};
    matrix[category][channel] = {
      stats:{
        impressions:num(row.impressions),
        clicks:num(row.clicks),
        leads:num(row.leads),
        activations:num(row.activations),
        verifiedRevenueEUR:num(row.verifiedRevenueEUR)
      },
      performance:audienceCellScore(row)
    };
  }

  return {
    schema:"affareradar.audience-matrix.v1",
    matrix
  };
}

export function recommendChannels(rows = [], category, options = {}) {
  const minConfidence = String(options.minConfidence || "LOW").toUpperCase();
  const confidenceRank = { INSUFFICIENT:0, LOW:1, MEDIUM:2, HIGH:3 };
  const minRank = confidenceRank[minConfidence] ?? 1;
  const target = safeKey(category);

  const candidates = (Array.isArray(rows) ? rows : [])
    .filter(row => safeKey(row.category) === target)
    .map(row => ({
      channel:safeKey(row.channel),
      stats:{
        impressions:num(row.impressions),
        clicks:num(row.clicks),
        leads:num(row.leads),
        activations:num(row.activations),
        verifiedRevenueEUR:num(row.verifiedRevenueEUR)
      },
      performance:audienceCellScore(row)
    }))
    .filter(x => (confidenceRank[x.performance.confidence] ?? 0) >= minRank)
    .sort((a,b) =>
      b.performance.score - a.performance.score ||
      b.performance.revenuePer1000Impressions - a.performance.revenuePer1000Impressions
    );

  return {
    schema:"affareradar.channel-recommendation.v1",
    category:target,
    ranked:candidates.map((x,i)=>({ rank:i+1, ...x })),
    fallback:
      candidates.length === 0
        ? "NO_CONFIDENT_DATA_USE_CURRENT_CHANNEL_STRATEGY"
        : null,
    principle:"VERIFIED_OUTCOMES_OVER_RAW_ENGAGEMENT"
  };
}
