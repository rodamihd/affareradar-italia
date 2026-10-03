import crypto from "node:crypto";

function hashBucket(value) {
  const hex = crypto.createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 8);
  return parseInt(hex, 16) % 100;
}

export function assignStrategyArm(dealId, options = {}) {
  const challengerPercent = Math.max(0, Math.min(50, Number(options.challengerPercent ?? process.env.AFFARERADAR_CHALLENGER_PERCENT ?? 10)));
  const bucket = hashBucket(dealId);
  return {
    arm:bucket < challengerPercent ? "CHALLENGER" : "CHAMPION",
    bucket,
    challengerPercent,
    executionMode:"SHADOW_ONLY"
  };
}

export function championChallengerVerdict(stats = {}) {
  const champion = stats.CHAMPION || {};
  const challenger = stats.CHALLENGER || {};

  const cN = Number(champion.impressions || 0);
  const hN = Number(challenger.impressions || 0);
  const cRevenue = Number(champion.revenueEUR || 0);
  const hRevenue = Number(challenger.revenueEUR || 0);

  const cRpm = cN > 0 ? cRevenue / cN * 1000 : 0;
  const hRpm = hN > 0 ? hRevenue / hN * 1000 : 0;

  const sufficient = cN >= 1000 && hN >= 300;
  const upliftPct = cRpm > 0 ? ((hRpm - cRpm) / cRpm) * 100 : null;

  let verdict = "INSUFFICIENT_EVIDENCE";
  if (sufficient && upliftPct != null) {
    if (upliftPct >= 10) verdict = "CHALLENGER_PROMOTION_CANDIDATE";
    else if (upliftPct <= -10) verdict = "CHALLENGER_REJECT_CANDIDATE";
    else verdict = "NO_MATERIAL_DIFFERENCE";
  }

  return {
    version:"1.0",
    executionMode:"SHADOW_ONLY",
    sufficient,
    verdict,
    championRPM:Number(cRpm.toFixed(2)),
    challengerRPM:Number(hRpm.toFixed(2)),
    upliftPct:upliftPct == null ? null : Number(upliftPct.toFixed(2)),
    samples:{ championImpressions:cN, challengerImpressions:hN }
  };
}
