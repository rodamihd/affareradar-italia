function clamp(v, min = 0, max = 100) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function optimizePublishingTime(body = {}, ctx = {}, now = Date.now()) {
  const d = new Date(now);
  const hour = d.getUTCHours();
  const urgency = clamp(ctx.persistence?.urgencyScore ?? 0);
  const quality = clamp(ctx.prediction?.qualityScore ?? ctx.opportunity?.score ?? 50);
  const confidence = String(ctx.outcomeProfile?.confidence || "low").toLowerCase();

  const localOffsetHours = Number(process.env.AFFARERADAR_LOCAL_UTC_OFFSET_HOURS || 2);
  const localHour = (hour + localOffsetHours + 24) % 24;
  const peak = (localHour >= 7 && localHour <= 9) || (localHour >= 12 && localHour <= 14) || (localHour >= 18 && localHour <= 22);
  const quiet = localHour >= 1 && localHour <= 6;

  let timingScore = quality;
  if (peak) timingScore += 10;
  if (quiet) timingScore -= 15;
  if (confidence === "high") timingScore += 5;
  timingScore = clamp(timingScore);

  const immediate = urgency >= 60 || body.dealType === "price_error" || body.historicalLow === true;
  let deferMinutes = 0;
  if (!immediate && quiet && timingScore < 85) deferMinutes = Math.max(15, (7 - localHour) * 60);
  else if (!immediate && !peak && timingScore < 65) deferMinutes = 30;

  return {
    version:"1.0",
    localHour,
    peakWindow:peak,
    quietWindow:quiet,
    urgencyScore:urgency,
    timingScore:Number(timingScore.toFixed(1)),
    publishNow:deferMinutes === 0,
    deferMinutes,
    reason:deferMinutes === 0 ? (immediate ? "urgency_override" : peak ? "peak_window" : "timing_acceptable") : quiet ? "quiet_window" : "wait_for_better_window"
  };
}
