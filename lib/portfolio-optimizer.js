function n(value, fallback = 0) {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}

function categoryKey(item = {}) {
  return String(item.category || "other").trim().toLowerCase() || "other";
}

function baseScore(item = {}) {
  const opportunity = n(item.opportunity?.score, n(item.dealScore, 0));
  const revenue = n(item.revenue?.expectedRevenuePer1000ImpressionsEUR, 0);
  const reliability = n(item.reliabilityScore, 50);
  const rewardBoost = item.reward ? 4 : 0;
  return opportunity * 0.65 + reliability * 0.2 + Math.min(20, revenue) * 0.75 + rewardBoost;
}

export function optimizePortfolio(items = [], options = {}) {
  const maxItems = Math.max(1, Math.min(20, n(options.maxItems, 5)));
  const maxPerCategory = Math.max(1, n(options.maxPerCategory, 2));
  const maxRewards = Math.max(0, n(options.maxRewards, 1));

  const scored = (items || [])
    .filter(Boolean)
    .map(item => ({ item, score:baseScore(item) }))
    .sort((a,b) => b.score - a.score);

  const selected = [];
  const categoryCounts = new Map();
  let rewards = 0;

  for (const row of scored) {
    if (selected.length >= maxItems) break;
    const category = categoryKey(row.item);
    const current = categoryCounts.get(category) || 0;
    const isReward = Boolean(row.item.reward || row.item.rewardProgram);

    if (current >= maxPerCategory) continue;
    if (isReward && rewards >= maxRewards) continue;

    selected.push({
      ...row.item,
      portfolioScore:Number(row.score.toFixed(2))
    });
    categoryCounts.set(category, current + 1);
    if (isReward) rewards += 1;
  }

  return {
    selected,
    diagnostics:{
      considered:scored.length,
      selected:selected.length,
      categoryCounts:Object.fromEntries(categoryCounts),
      rewards,
      maxItems,
      maxPerCategory,
      maxRewards
    }
  };
}
